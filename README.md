# graphql-cli-load

Data import plugin for graphql-cli.

## Installation

```
npm i -g graphql-cli graphql-cli-load
```

## Configuration

Configure the plugin via the `.graphqlconfig` or command line.

The schema will be obtained from the `schemaPath` key, you can fetch it via `graphql get-schema`

All other options such as `csv`, `json`, `mutation` or `mapping` _can_ be placed in the `extensions.load` key
or provided via commandline.

Here is an example:

`.graphqlconfig`
```json
{
  "schemaPath": "schema.graphql",
  "includes": [
    "src/**/*.graphql",
    "src/**/*.gql",
  ],
  "extensions": { 
    "load": { // this section is optional
      "csv" : "reviews.txt",
      "mutation": "createReview",
      "mapping": { "text" : "review", "rating" : "stars"}
    }
  }
}
```

## Usage

You can now run:

```
graphql load
```

or

```
graphql load --csv reviews.txt --mutation createReview2 --mapping '{ "text" : "commentary", "rating" : "stars"}'

Using endpoint starwars: http://localhost:7474/graphql/
Using mutation "createReview2".

Done parsing CSV-file /Users/mh/d/js/graphql-cli-load/example/reviews.txt rows: 3
 meta: {"delimiter":"\t","linebreak":"\n","aborted":false,"truncated":false,"cursor":566,"fields":["episode","text","rating"]}

Using mapping: {"text":"commentary","rating":"stars"}

Sending query:
mutation { 
_0 : createReview2 ( episode: NEWHOPE,commentary: "A legendarily expansive and ambitious start to the sci-fi saga, George Lucas opened our eyes to the possibilities of blockbuster filmmaki...

✔ Call succeeded:
{"_0":"Nodes created: 1\nProperties set: 3\nLabels added: 1\n","_1":"Nodes created: 1\nProperties set: 3\nLabels added: 1\n","_2":"Nodes created: 1\nProperties set: 3\nLabels added: 1\n"}...
```

## Options

```
graphql load [--json=file.json] [--csv=file.csv] [--endpoint=name] [--mutation=createType] [--mapping='{"title":"name"}']

Optionen:
  --help          show help
  --mapping, -p   name mapping of input to mutation (json)
  --mutation, -m  mutation to call
  --endpoint, -e  endpoint name to use
  --json, -j      json file to load
  --csv, -c       csv file to load
```

Which will take each line of the csv or json file and call the mutation with the data (optionally mapping columns).
Non-absolute files are resolved relative to the directory containing `.graphqlconfig`.

## TODO

* parameters
* type conversion
* file urls


## Test with Neo4j-GraphQL Extension

To test this with the neo4j-graphql extension:

1. `npm install -g neo4j-graphql-cli`
2. `neo4j-graphql example/example-schema.graphql` (remember the auth header)
4. `npm install -g graphql-cli graphql-cli-load`
5. Run `graphql` in `example` to install the endpoint, and manually add the auth-header, like here:
```
"endpoints": {
  "starwars": {"url":"http://localhost:7474/graphql/","headers":{"Authorization": "Basic bmVvNGo6dGVzdA=="}}
},
```
6. Run `graphql load --csv reviews2.txt` or `graphql load --csv reviews2.json`