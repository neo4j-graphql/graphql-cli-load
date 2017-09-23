import {buildASTSchema,parse,GraphQLSchema,graphql,getNamedType,GraphQLNonNull} from 'graphql';
import { GraphQLClient, request } from 'graphql-request';

import * as papa from 'papaparse';

import * as chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';

export const command = 'load [--json] [--csv] [--endpoint] [--mutation] [--mapping] [--delim]';
export const desc = 'Loads data from sources using mutations using .graphqlconfig';
export const builder = {
    mapping: {
        alias: 'p',
        description: 'name mapping of input to mutation (json)'
    },
    mutation: {
        alias: 'm',
        description: 'mutation to call'
    },
    endpoint: {
        alias: 'e',
        description: 'endpoint name to use'
    },
    json: {
        alias: 'j',
        description: 'json file to load'
    },
    csv: {
        alias: 'c',
        description: 'csv file to load'
    },
    delim: {
        alias: 'd',
        description: 'delimiter for arrays'
    }
};

function getSchema(config, basePath) {
  const schemaPath = path.join(basePath, config.schemaPath);
  const schemaContents = fs.readFileSync(schemaPath).toString();
  return buildASTSchema(parse(schemaContents));
};

function readFile(basePath, options, argv) {
  var file = argv.csv || options.csv;
  if (file) {
    file = (file[0] == '/') ? file : path.join(basePath, file);
    const text = fs.readFileSync(file,'utf-8');
    const data = papa.parse(text,{header:true});
    if (data.errors.length > 0) {
        return console.log(chalk.red(`Error parsing CSV-file ${file} rows: ${data.data.length} errors: ${JSON.stringify(data.errors)}\n meta: ${JSON.stringify(data.meta)}`));
    }
    console.log(chalk.green(`Done parsing CSV-file ${file} rows: ${data.data.length}\n meta: ${JSON.stringify(data.meta)}`));
    return data.data;
  }
  file = argv.json || options.json;
  if (file) {
    file = (file[0] == '/') ? file : path.join(basePath, file);
    const text = fs.readFileSync(file,'utf-8');
    const data = JSON.parse(text); 
    if (!data) {
        return console.log(chalk.red(`Error parsing JSON-file ${file}`));
    }
    console.log(chalk.green(`Done parsing JSON-file ${file} rows: ${data.length}`));
    return data;
  } else {
    return console.log(chalk.red(`No csv or json file configured in section "load"`));
  }
}

function getEndpoint(config, argv) {
  const extensions = config.extensions || {};
  const endpoints = extensions.endpoints || {};

  const key = argv.endpoint || Object.keys(endpoints)[0];
  if (!key) {
    return console.log(chalk.red(`No endpoint found.`));
  }
  const endpoint = endpoints[key];
  if (!endpoint) {
    return console.log(chalk.red(`No endpoint ${key} found.`));
  }
  console.log(chalk.green(`Using endpoint ${key}: ${endpoint.url}`));
  return endpoint;
}

function getMutation(config, basePath, argv) {
  const extensions = config.extensions || {};
  const options = extensions.load || {};

  const schema = getSchema(config, basePath);

  const mutationType = schema.getMutationType()
  if (!mutationType) {
    return console.log(chalk.red(`No mutation type in schema.`));
  }
  const fields = mutationType.getFields();
  const mutationName = argv.mutation || options.mutation;
  const mutationField = fields[mutationName];
  if (!mutationField) {
    return console.log(chalk.red(`Mutation for "${mutationName}" not found.`));
  }
  console.log(chalk.green(`Using mutation "${mutationField.name}": "${mutationField.description}".`));
  return mutationField;
}

function buildMutations(mutationField, args, data, mapping,delim) {
  const rMapping = {};
  const regexp = new RegExp(delim + "\s*");
  Object.keys(mapping).forEach((k) => rMapping[mapping[k]]=k);
  const mutations = 
  data.map((row,idx) => {
    var fullfilled = true;
    const params = Object.keys(args).map( (key) => { 
      const arg = args[key];
      const column=(rMapping[key]||key).toString();
      // todo params
      var value=row[column]; // sometimes this is not wanted, e.g. if there is a crossover naming // || row[key]
      const type = arg.type.toString();
      const namedType = getNamedType(arg.type).name;
      const isList = type.indexOf("]") != -1;
      const isNonNull = type.charAt(type.length -1 ) == '!';
      if (value === null || value === undefined) {
         if (isNonNull) fullfilled = false;
         return null;
      }
      if (isList) {
         if (!Array.isArray(value)) {
            if (typeof(value)=='string') {
               value = value.trim();
               if (value.charAt(0)=='[') value = JSON.parse(value)
               else if (value.indexOf(delim) > -1) value = value.split(regexp);
            }
         }
      }
      if (isList) {
         value=JSON.stringify(value);
      } else if (namedType == "String" || namedType == "ID" ) {
         value=JSON.stringify(value.toString());
      }
      return `${arg.name}: ${value}`;
    }).filter((v) => v !== null).join(",");
    return fullfilled ? `_${idx} : ${mutationField.name} ( ${params} )` : null;
  }).filter((v) => v !== null).join("\n");

  return "mutation { \n" + mutations +"\n}";  
}

function parseJson(str) {
   try {
      return JSON.parse(str);
   } catch(e) {
      throw new Error(`Error parsing ${str} as JSON: ${e}`);
   }
}

export const handler = async ({getConfig},argv) => {
  const {config, configPath} = getConfig();
  const basePath = path.dirname(configPath);
  const extensions = config.extensions || {};
  const options = extensions.load || {};

  const endpoint = getEndpoint(config,argv);
  if (!endpoint) return;

  const mutationField = getMutation(config,basePath, argv);
  if (!mutationField) return;

  var args = {};
  mutationField.args.forEach((arg) => args[arg.name]=arg);

  const data = readFile(basePath, options, argv);
  const mapping = parseJson(argv.mapping||"null") || options.mapping || {};
  if (Object.keys(mapping).length > 0) {
     console.log(chalk.yellow(`Using mapping: ${JSON.stringify(mapping)}`));
  }
  const delim = argv.delim || ';';
  const mutations = buildMutations(mutationField, args, data, mapping, delim);

  console.log(chalk.yellow(`Sending query:\n${mutations.substring(0,200)}...`));
  const client = new GraphQLClient(endpoint.url, endpoint);
  const result = await client.request(mutations, {});
  if (result["errors"]) {
    console.log(chalk.red(`X Call failed! ${JSON.stringify(result["errors"])}`))
  } else {
     console.log(chalk.green(`✔ Call succeeded:\n${JSON.stringify(result).substring(0,200)}...`));
  }
};
