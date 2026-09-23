# Installing `@softobotics/s3-plugin` in another repository (private package)

> Internal reference only - not shipped with the published package (npm publishes `README.md`
> automatically regardless of the `files` field in `package.json`, so this content was moved out
> of `README.md` to avoid it appearing on the npm package page).

`@softobotics/s3-plugin` is published to the npm registry as a **private** scoped package
(`publishConfig.access: "restricted"`) - it does not appear in public search and cannot be
installed anonymously. To install it from a different Vendure project:

1. The npm account/org that owns the `@softobotics` scope must have a plan that supports private
   packages (npm Pro for a personal scope, or a paid Team/Org plan for an npm organization).
2. Whoever is installing it needs to be authenticated as a user with read access to the package,
   or use a **granted access token** scoped to `@softobotics/s3-plugin`:

    ```shell
    npm login
    # or, for CI / another machine, put a token in .npmrc instead of logging in interactively:
    echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" >> ~/.npmrc
    ```

3. Then install as normal - no special registry URL is needed, since it's still published to the
   default npm registry, just marked private:

    ```shell
    npm install @softobotics/s3-plugin @aws-sdk/client-s3 @aws-sdk/lib-storage
    ```

4. Follow the [Setup](../README.md#setup) section in the README to wire it into that project's
   `VendureConfig`.
