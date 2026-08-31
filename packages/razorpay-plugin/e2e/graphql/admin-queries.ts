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
