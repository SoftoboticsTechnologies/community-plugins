import gql from 'graphql-tag';

export const CREATE_SHIPPING_METHOD = gql`
    mutation CreateShippingMethod($input: CreateShippingMethodInput!) {
        createShippingMethod(input: $input) {
            id
            code
        }
    }
`;

export const CREATE_PAYMENT_METHOD = gql`
    mutation CreatePaymentMethod($input: CreatePaymentMethodInput!) {
        createPaymentMethod(input: $input) {
            id
            code
        }
    }
`;

export const ADD_FULFILLMENT_TO_ORDER = gql`
    mutation AddFulfillmentToOrder($input: FulfillOrderInput!) {
        addFulfillmentToOrder(input: $input) {
            ... on Fulfillment {
                id
                state
                method
                customFields {
                    shiprocketShipmentId
                    shiprocketAwbCode
                    shiprocketCourierName
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on CreateFulfillmentError {
                fulfillmentHandlerError
            }
        }
    }
`;

export const GET_ORDER = gql`
    query GetOrder($id: ID!) {
        order(id: $id) {
            id
            code
            state
            lines {
                id
                quantity
            }
            fulfillments {
                id
                state
                customFields {
                    shiprocketShipmentId
                }
            }
        }
    }
`;
