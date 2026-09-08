import gql from 'graphql-tag';

export const PAYMENT_METHOD_FRAGMENT = gql`
    fragment PaymentMethodFragment on PaymentMethod {
        id
        code
        enabled
        handler {
            code
            args {
                name
                value
            }
        }
    }
`;

export const CREATE_PAYMENT_METHOD = gql`
    mutation CreatePaymentMethod($input: CreatePaymentMethodInput!) {
        createPaymentMethod(input: $input) {
            ...PaymentMethodFragment
        }
    }
    ${PAYMENT_METHOD_FRAGMENT}
`;

export const REFUND_ORDER = gql`
    mutation RefundOrder($input: RefundOrderInput!) {
        refundOrder(input: $input) {
            ... on Refund {
                id
                state
                transactionId
                total
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const GET_ORDER_WITH_REFUNDS = gql`
    query GetOrderWithRefunds($id: ID!) {
        order(id: $id) {
            id
            code
            payments {
                id
                transactionId
                refunds {
                    id
                    state
                    transactionId
                    total
                }
            }
        }
    }
`;

export const GET_ZONES = gql`
    query GetZones {
        zones {
            items {
                id
                name
            }
        }
    }
`;

export const CREATE_CHANNEL = gql`
    mutation CreateChannel($input: CreateChannelInput!) {
        createChannel(input: $input) {
            ... on Channel {
                id
                code
                token
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const GET_SHIPPING_METHODS = gql`
    query GetShippingMethods {
        shippingMethods {
            items {
                id
                code
            }
        }
    }
`;

export const ASSIGN_SHIPPING_METHODS_TO_CHANNEL = gql`
    mutation AssignShippingMethodsToChannel($input: AssignShippingMethodsToChannelInput!) {
        assignShippingMethodsToChannel(input: $input) {
            id
        }
    }
`;

export const GET_PRODUCTS = gql`
    query GetProducts {
        products {
            items {
                id
            }
        }
    }
`;

export const ASSIGN_PRODUCTS_TO_CHANNEL = gql`
    mutation AssignProductsToChannel($input: AssignProductsToChannelInput!) {
        assignProductsToChannel(input: $input) {
            id
        }
    }
`;
