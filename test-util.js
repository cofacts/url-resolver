const { graphql } = require('graphql');
const schema = require('./schema');

/**
 * Executes graphql query against the current GraphQL schema.
 *
 * Usage:
 * const result = await gql`query{...}`(variable)
 *
 * @returns {(variable: Object) => Promise<GraphQLResult>}
 */
function gql(query, ...substitutes) {
  return variables =>
    graphql(schema, String.raw(query, ...substitutes), null, {}, variables);
}

exports.gql = gql;
