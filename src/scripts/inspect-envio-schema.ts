/**
 * Introspect Envio GraphQL schema for event filter fields.
 *
 * Usage:
 *   ENVIO_ENDPOINT=... npx tsx src/scripts/inspect-envio-schema.ts
 *   ENVIO_TYPE=Morpho_Supply npx tsx src/scripts/inspect-envio-schema.ts
 */

import "dotenv/config";
import { createEnvioGraphQLClient } from "../envio/client.js";

// GraphQL Introspection types
interface GraphQLTypeRef {
  kind: string;
  name: string | null;
  ofType?: GraphQLTypeRef | null;
}

interface GraphQLField {
  name: string;
  type: GraphQLTypeRef;
}

interface IntrospectionResponse {
  __type?: {
    name: string;
    inputFields?: GraphQLField[];
    fields?: GraphQLField[];
  };
}

const endpoint = process.env.ENVIO_ENDPOINT;
if (!endpoint) {
  console.error("ENVIO_ENDPOINT is required");
  process.exit(1);
}

const eventType = process.env.ENVIO_TYPE ?? "Morpho_Supply";
const boolExpType = `${eventType}_bool_exp`;

const client = createEnvioGraphQLClient(endpoint);

const boolExpQuery = `
  query IntrospectBoolExp($name: String!) {
    __type(name: $name) {
      name
      inputFields {
        name
        type {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
      }
    }
  }
`;

const objectQuery = `
  query IntrospectObject($name: String!) {
    __type(name: $name) {
      name
      fields {
        name
        type {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
      }
    }
  }
`;

function flattenType(type: GraphQLTypeRef | null | undefined): string {
  if (!type) return "";
  if (type.kind === "NON_NULL") return `${flattenType(type.ofType)}!`;
  if (type.kind === "LIST") return `[${flattenType(type.ofType)}]`;
  return type.name ?? "";
}

async function main() {
  const boolExp = await client.request<IntrospectionResponse>(boolExpQuery, { name: boolExpType });
  const object = await client.request<IntrospectionResponse>(objectQuery, { name: eventType });

  const boolFields = boolExp?.__type?.inputFields ?? [];
  const objectFields = object?.__type?.fields ?? [];

  console.log(`\n${boolExpType} input fields:`);
  for (const field of boolFields) {
    console.log(`- ${field.name}: ${flattenType(field.type)}`);
  }

  console.log(`\n${eventType} fields:`);
  for (const field of objectFields) {
    console.log(`- ${field.name}: ${flattenType(field.type)}`);
  }
}

main().catch((error) => {
  console.error("Schema introspection failed:", error);
  process.exit(1);
});
