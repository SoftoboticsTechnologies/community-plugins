import gql from 'graphql-tag';

export const TEST_ORDER_FRAGMENT = gql`
    fragment TestOrderFragment on Order {
        id
        code
        state
        active
        totalWithTax
        currencyCode
        payments {
            id
            transactionId
            method
            amount
            state
            metadata
        }
    }
`;

export const ADD_ITEM_TO_ORDER = gql`
    mutation AddItemToOrder($productVariantId: ID!, $quantity: Int!) {
        addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
            ...TestOrderFragment
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
    ${TEST_ORDER_FRAGMENT}
`;

export const SET_SHIPPING_ADDRESS = gql`
    mutation SetShippingAddress($input: CreateAddressInput!) {
        setOrderShippingAddress(input: $input) {
            ...TestOrderFragment
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
    ${TEST_ORDER_FRAGMENT}
`;

export const GET_ELIGIBLE_SHIPPING_METHODS = gql`
    query GetEligibleShippingMethods {
        eligibleShippingMethods {
            id
            price
            name
        }
    }
`;

export const SET_SHIPPING_METHOD = gql`
    mutation SetShippingMethod($id: [ID!]!) {
        setOrderShippingMethod(shippingMethodId: $id) {
            ...TestOrderFragment
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
    ${TEST_ORDER_FRAGMENT}
`;

export const TRANSITION_TO_STATE = gql`
    mutation TransitionToState($state: String!) {
        transitionOrderToState(state: $state) {
            ...TestOrderFragment
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
    ${TEST_ORDER_FRAGMENT}
`;

export const GET_ACTIVE_ORDER = gql`
    query GetActiveOrder {
        activeOrder {
            ...TestOrderFragment
        }
    }
    ${TEST_ORDER_FRAGMENT}
`;

export const CREATE_RAZORPAY_ORDER = gql`
    mutation CreateRazorpayOrder {
        createRazorpayOrder {
            orderId
            amount
            currency
            keyId
        }
    }
`;

export const ADD_PAYMENT = gql`
    mutation AddPaymentToOrder($input: PaymentInput!) {
        addPaymentToOrder(input: $input) {
            ...TestOrderFragment
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
    ${TEST_ORDER_FRAGMENT}
`;
