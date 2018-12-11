# @atomist/sdm-pack-docker

[![atomist sdm goals](http://badge.atomist.com/T29E48P34/atomist/sdm-pack-docker/275b4284-9942-41c8-9b91-e90957d99188)](https://app.atomist.com/workspace/T29E48P34)
[![npm version](https://img.shields.io/npm/v/@atomist/sdm-pack-docker.svg)](https://www.npmjs.com/package/@atomist/sdm-pack-docker)

[Atomist][atomist] software delivery machine (SDM) extension Pack for an Atomist SDM to
integrate [docker](https://www.docker.io).

See the [Atomist documentation][atomist-doc] for more information on
what SDMs are and what they can do for you using the Atomist API for
software.

[atomist-doc]: https://docs.atomist.com/ (Atomist Documentation)

## Usage

### Docker Image Creation

TODO

### Dockerfile Parsing and Manipulation

This module includes support for parsing Docker files, within the Atomist
[tree path](https://github.com/atomist/tree-path) model. This allows us to
query instructions in Docker files and update them without otherwise changing
file content or formatting.

The following example returns the image name:

```typescript
const images: string[] = await astUtils.findValues(p, DockerFileParser, "Dockerfile",
     "//FROM/image/name");
```

The following example uses `DockerFileParser` exported by this package, to update
an image tag of `argon`, from `node:argon` to `xenon` to produce a file referencing
`node:xenon`.

```typescript
await astUtils.doWithAllMatches(p, DockerFileParser, "Dockerfile",
    "//FROM/image/tag",
    n => n.$value = "xenon");
```

This example uses a custom function to find all `RUN` instructions that invoke `rm`:

```typescript
const runs = await astUtils.findValues(p, DockerFileParser, "Dockerfile",
    "//RUN[?removes]",
    {
        removes: n => n.$value.includes("rm "),
    });
```

Please see `dockerFileParser.test.ts` for further examples.

## Support

General support questions should be discussed in the `#support`
channel in the [Atomist community Slack workspace][slack].

If you find a problem, please create an [issue][].

[issue]: https://github.com/atomist/sdm-pack-docker/issues

## Development

You will need to install [Node][node] to build and test this project.

[node]: https://nodejs.org/ (Node.js)

### Build and test

Use the following package scripts to build, test, and perform other
development tasks.

Command | Reason
------- | ------
`npm install` | install project dependencies
`npm run build` | compile, test, lint, and generate docs
`npm run lint` | run TSLint against the TypeScript
`npm run compile` | generate types from GraphQL and compile TypeScript
`npm test` | run tests
`npm run autotest` | run tests every time a file changes
`npm run clean` | remove files generated during build

### Release

Releases are handled via the [Atomist SDM][atomist-sdm].  Just press
the 'Approve' button in the Atomist dashboard or Slack.

[atomist-sdm]: https://github.com/atomist/atomist-sdm (Atomist Software Delivery Machine)

---

Created by [Atomist][atomist].
Need Help?  [Join our Slack workspace][slack].

[atomist]: https://atomist.com/ (Atomist - How Teams Deliver Software)
[slack]: https://join.atomist.com/ (Atomist Community Slack)

[atomist]: https://atomist.com/ (Atomist - Development Automation)
[slack]: https://join.atomist.com/ (Atomist Community Slack)
