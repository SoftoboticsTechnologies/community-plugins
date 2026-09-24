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

    type ShopifyConnection {
        storeUrl: String!
        connectedAt: DateTime!
    }

    type ShopifyProductSummary {
        id: ID!
        title: String!
        handle: String!
        imageUrl: String
        variantCount: Int!
    }

    extend type Query {
        shopifyConnection: ShopifyConnection
        listShopifyProducts: [ShopifyProductSummary!]!
    }

    extend type Mutation {
        disconnectShopify: Boolean!
        importSelectedShopifyProducts(productIds: [ID!]!, skipInvalidRows: Boolean): ShopifyApiImportResult!
    }
`;
