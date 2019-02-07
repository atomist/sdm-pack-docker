# @atomist/sdm-pack-docker

[![atomist sdm goals](http://badge.atomist.com/T29E48P34/atomist/sdm-pack-docker/275b4284-9942-41c8-9b91-e90957d99188)](https://app.atomist.com/workspace/T29E48P34)
[![npm version](https://img.shields.io/npm/v/@atomist/sdm-pack-docker.svg)](https://www.npmjs.com/package/@atomist/sdm-pack-docker)

[Atomist][atomist] software delivery machine (SDM) extension Pack for an Atomist SDM to integrate [docker](https://www.docker.io).

See the [Atomist documentation][atomist-doc] for more information on
what SDMs are and what they can do for you using the Atomist API for
software.

[atomist-doc]: https://docs.atomist.com/ (Atomist Documentation)

## Usage

Configuration Reference:

```json
{
  ...
  sdm: {
    "docker": {
      "build": {
        "push": boolean // Optional. Enable or disable pushes of images.
      },
      "tag": {
        "latest": boolean // Optional. Should new images also be tagged with latest
      }
    },
    "cache": {
      "enabled": boolean // Optional. Enable or disable caching support (specific to kaniko)
      "path": string // Optionally configure a new FS location for the cache path.  Defaults to /opt/data
    },
    "dockerinfo": {
       "registries": [
         { // Docker hub example
           "username": string, // Optional
           "password": string, // Optional
           "url": "registry.hub.docker.com/<user/org>",         // Full path to your registry - including user/org
           "displayUrl": "https://hub.docker.com/r/<user/org>", // Optional.  Customized display URL.  Will replace url.
           "displayBrowsePath": "/tags",                        // Optional.  Customized suffix.  Will replace :<version> in the full image tag
           "label": "Dockerhub",                                // Optional.  Display a friendly name for this docker registry (otherwise use full url)
           "display": true                                      // Optional.  Should we include this link with the goal externalUrls
         },
         { // GCR Example
           "url": "gcr.io/<your project name>-<your project id>",
           "display": true,
           "label": "GCR",
           "displayUrl": "https://console.cloud.google.com/gcr/images/<your project name>-<your project id>/GLOBAL",
           "displayBrowsePath": "?project=<your project id>&gcrImageListsize=30"
         }
       ]
    }
  }

}

```

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
