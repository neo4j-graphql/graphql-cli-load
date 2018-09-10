import {buildASTSchema,parse,GraphQLSchema,GraphQLObjectType,graphql,getNamedType,GraphQLNonNull,GraphQLID} from 'graphql';
import { GraphQLClient, request } from 'graphql-request';

import * as papa from 'papaparse';

import chalk from 'chalk';
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

function getSchema(config) {
  console.log("At getSchema the config parameter is: " + JSON.stringify(config))
  const schemaPath = config.schemaPath;
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
  var endpoint = endpoints[key];
  if (!endpoint) {
    return console.log(chalk.red(`No endpoint ${key} found.`));
  }
  if (typeof(endpoint) === "string") {
     endpoint = { url: endpoint};
  }
  console.log(chalk.green(`Using endpoint ${key}: ${JSON.stringify(endpoint)	}`));
  return endpoint;
}

function getMutation(config, argv) {
  const extensions = config.extensions || {};
  const options = extensions.load || {};

  const schema = getSchema(config);

  const mutationType = schema.getMutationType()
  if (!mutationType) {
    return console.log(chalk.red(`No mutation type in schema.`));
  }
  const fields = mutationType.getFields();
  const mutationName = argv.mutation || options.mutation;
  // console.log("mutationName at getMutation is " + mutationName)
  const mutationField = fields[mutationName];
  // console.log(chalk.red("mutationField at getMutation is " + JSON.stringify(mutationField)))
  if (!mutationField) {
    return console.log(chalk.red(`Mutation for "${mutationName}" not found.`));
  }
  console.log(chalk.green(`Using mutation "${mutationField.name}": "${mutationField.description}".`));
  return mutationField;
}

function findReturnExpression(mutationField) {
    // console.log(chalk.yellow("At findReturnExpression, the mutationField is " + JSON.stringify(mutationField)))
    const returnType = getNamedType(mutationField.type)
    if (returnType instanceof GraphQLObjectType) {
       const fields = (returnType as GraphQLObjectType).getFields();
       const field = Object.keys(fields).find((x) => (getNamedType(fields[x].type) === GraphQLID)) || Object.keys(fields)[0]
       // console.log("field at findReturnExpression is: " + field)
	return `{ ${field} }`
    }
    return "";
}

function buildMutations(mutationField, args, data, mapping,delim) {
  // console.log("\n mutationField parameter at buildMutations is " + JSON.stringify(mutationField))
  // console.log("\n args parameter at buildMutations is " + JSON.stringify( args))
  const rMapping = {};
  const regexp = new RegExp(delim + "\s*");
  Object.keys(mapping).forEach((k) => rMapping[mapping[k]]=k);
  console.log("While mapping is " + JSON.stringify(mapping) + " , but rMapping is " + JSON.stringify(rMapping))
  const mutations = 
  data.map((row,idx) => {
    console.log("\n row when it was declared is: " + JSON.stringify(row))
    var fullfilled = true;
    const params = Object.keys(args).map( (key) => { 
      const arg = args[key];
      // console.log(chalk.white("At buildMutations, the arg inside data.map is " + JSON.stringify(arg)))
      // console.log("arg.name inside data.map at getMutation is " + arg.name)
     //  const column=(rMapping[key]||key).toString(); // original
      console.log("Correcting the key mapping data with const column =  mapping[key].toString() is " + (mapping[key]).toString())
      const column = mapping[key].toString()
      console.log("\n At data.map in buildMutations key is: "+ key + " and rMapping is: "+ JSON.stringify(rMapping))
      // todo params
      console.log("When naming the values, we use row[column] where column is: " + column)
      // console.log("Alternatively testing, we can also find out what row[key] is " + row["episode"])
      var value=row[column]; // sometimes this is not wanted, e.g. if there is a crossover naming // || row[key]
      const type = arg.type.toString();
      const namedType = getNamedType(arg.type).name;
      const isList = type.indexOf("]") != -1;
      const isNonNull = type.charAt(type.length -1 ) == '!';
      if (value === null || value === undefined) {
         if (isNonNull) fullfilled = false;
         	console.log("At data.map in buildMutations if value === null || undefined, value is: " + value)
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
      console.log("return arg.name" + arg.name + " : value " + value + " in data.map at buildMutations")
      return `${arg.name}: ${value}`;
    }).filter((v) => v !== null).join(",");
    const returnExpression = findReturnExpression(mutationField);
    console.log("\n returnExpression at data.map at buildMutations returns: " + returnExpression)
    return fullfilled ? `_${idx} : ${mutationField.name} ( ${params} ) ${returnExpression}` : null;
  }).filter((v) => v !== null).join("\n");
  console.log("\n buildMutations returns: " + mutations)
  return "mutation { \n" + mutations +"\n}";  
}

function parseJson(str) {
   try {
      return JSON.parse(str);
   } catch(e) {
      throw new Error(`Error parsing ${str} as JSON: ${e}`);
   }
}

exports.handler = async function (context, argv) {
  console.log("Graphql-load has been invoked")
  const config = await context.getProjectConfig()
  const schema = config.getSchemaSDL();
  const configPath = config.configPath

  const extensions = config.extensions || {};
  const options = extensions.load || {};

  const endpoint = getEndpoint(config,argv);
  if (!endpoint) return;

  const mutationField = getMutation(config, argv);
  if (!mutationField) return;

  var args = {};
  mutationField.args.forEach((arg) => args[arg.name]=arg);

  const data = readFile(path.dirname(configPath), options, argv);
  const mapping = parseJson(argv.mapping||"null") || options.mapping || {};

  if (Object.keys(mapping).length > 0) {
     console.log(chalk.yellow(`Using mapping: ${JSON.stringify(mapping)}`));
  }
  const delim = argv.delim || ';';
  const mutations = buildMutations(mutationField, args, data, mapping, delim);
  console.log("mutations at mainWorkflow is " + mutations)
  console.log("Let's see if the error is " + mutations.substring(0,200))
  console.log(chalk.yellow(`Sending query:\n${mutations.substring(0,200)}...`));
  const client = new GraphQLClient(endpoint.url, endpoint);
  const result = await client.request(mutations, {});
  if (result["errors"]) {
    console.log(chalk.red(`X Call failed! ${JSON.stringify(result["errors"])}`))
  } else {
     console.log(chalk.green(`✔ Call succeeded:\n${JSON.stringify(result).substring(0,200)}...`));
  }
};
