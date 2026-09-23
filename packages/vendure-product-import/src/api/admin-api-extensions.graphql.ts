import gql from 'graphql-tag';

export const adminApiExtensions = gql`
    type ImportRowError {
        row: Int!
        column: String!
        message: String!
    }

    type ShopifyApiImportResult {
        processed: Int!
        createdProducts: Int!
        createdVariants: Int!
        skippedRows: Int!
        errors: [ImportRowError!]!
    }

    extend type Mutation {
        importFromShopifyApi(storeUrl: String!, accessToken: String!, skipInvalidRows: Boolean): ShopifyApiImportResult!
    }
`;
