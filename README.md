# waste-organisation-backend

[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_waste-organisation-backend&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=DEFRA_waste-organisation-backend)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_waste-organisation-backend&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=DEFRA_waste-organisation-backend)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_waste-organisation-backend&metric=coverage)](https://sonarcloud.io/summary/new_code?id=DEFRA_waste-organisation-backend)

The Waste Organisation Backend is a Hapi.js API service that manages waste receiver organisations,
spreadsheet uploads, API code generation, and email notifications via GOV.UK Notify. It uses MongoDB
for persistence and integrates with AWS S3/SQS (via LocalStack locally) for file storage and
background processing.

- [Prerequisites](#prerequisites)
- [Environment variables](#environment-variables)
  - [GOV_NOTIFY_KEY](#gov_notify_key)
- [Local development](#local-development)
  - [Setup](#setup)
  - [Development](#development)
  - [Testing](#testing)
  - [Production](#production)
  - [Npm scripts](#npm-scripts)
- [API endpoints](#api-endpoints)
- [Authentication](#authentication)
- [Development helpers](#development-helpers)
  - [MongoDB Locks](#mongodb-locks)
  - [Proxy](#proxy)
- [Docker](#docker)
  - [Development image](#development-image)
  - [Production image](#production-image)
  - [Docker Compose](#docker-compose)
- [SonarCloud](#sonarcloud)
- [Dependabot](#dependabot)
- [Licence](#licence)
  - [About the licence](#about-the-licence)

## Prerequisites

For latest minimum versions of Node.js and NPM, see the [package.json](./package.json) 'engines'
property.

- [Node.js](http://nodejs.org/)
- [npm](https://www.npmjs.com/)
- [Docker](https://www.docker.com/)

You may find it easier to manage Node.js versions using a version manager such
as [nvm](https://github.com/creationix/nvm) or [n](https://www.npmjs.com/package/n). From within the
project folder you can then either run `nvm use` or `n auto` to install the required version.

## Environment variables

For most local development, you shouldn't need to override any of the env var defaults that are
in [config.js](./src/config.js).

### `GOV_NOTIFY_KEY`

This service uses [GOV.UK Notify](https://www.notifications.service.gov.uk/) to send email notifications to users after spreadsheet processing (success, failure, and validation failure). The `GOV_NOTIFY_KEY` environment variable holds the API key used to authenticate with the Notify service.

You can obtain a key from the [GOV.UK Notify dashboard](https://www.notifications.service.gov.uk/sign-in) under **API integration** > **API keys**.

The key is passed into the Docker container via `compose.yml` as `${GOV_NOTIFY_KEY}`, so it must be available in your host environment before running `docker compose up`. Options for managing this include a `.env` file, your shell profile, or tools like `direnv`.

Without this key, email notifications after spreadsheet processing will fail.

## Local development

### Setup

Install application dependencies:

```bash
npm install
```

### Development

To run the application and all its dependencies (Localstack, Redis, MongoDB) in Docker:

```bash
npm run start:docker
```

To run headless (detached mode):

```bash
npm run start:docker -- -d
```

To stop all services:

```bash
npm run stop:docker
```

To run the application outside of Docker (requires infrastructure services to be running separately):

```bash
npm run dev
```

### Testing

To test the application run:

```bash
npm run test
```

### Production

To mimic the application running in `production` mode locally run:

```bash
npm start
```

### Npm scripts

All available Npm scripts can be seen in [package.json](./package.json).
To view them in your command line run:

```bash
npm run
```

## API endpoints

| Endpoint                                            | Method | Description                              |
| :-------------------------------------------------- | :----- | :--------------------------------------- |
| `/health`                                           | GET    | Health check (no auth required)          |
| `/user/{userId}/organisations`                      | GET    | Get all organisations for a user         |
| `/user/{userId}/organisation/{organisationId}`      | PUT    | Update organisation                      |
| `/spreadsheet/{organisationId}`                     | GET    | Get all spreadsheets for an organisation |
| `/spreadsheet/{organisationId}/{uploadId}`          | GET    | Get a specific spreadsheet               |
| `/spreadsheet/{organisationId}/{uploadId}`          | PUT    | Update spreadsheet (triggers SQS job)    |
| `/organisation/{apiCode}`                           | GET    | Lookup organisation by API code          |
| `/organisation/{organisationId}/apiCodes`           | GET    | List API codes for an organisation       |
| `/organisation/{organisationId}/apiCodes`           | POST   | Create a new API code                    |
| `/organisation/{organisationId}/apiCodes/{apiCode}` | PUT    | Update API code (name/disabled status)   |

## Authentication

All endpoints except `/health` require API key authentication. The key can be provided via:

- `x-auth-token` header
- `Authorization: Basic` header

API keys are configured via `WASTE_CLIENT_AUTH_*` environment variables (any variable with that
prefix is treated as a valid pre-shared key).

## Development helpers

### MongoDB Locks

If you require a write lock for Mongo you can acquire it via `server.locker` or `request.locker`:

```javascript
async function doStuff(server) {
  const lock = await server.locker.lock('unique-resource-name')

  if (!lock) {
    return
  }

  try {
    // do stuff
  } finally {
    await lock.free()
  }
}
```

Keep it small and atomic.

You may use **using** for the lock resource management.
Note test coverage reports do not like that syntax.

```javascript
async function doStuff(server) {
  await using lock = await server.locker.lock('unique-resource-name')

  if (!lock) {
    return
  }

  // do stuff
}
```

Helper methods are also available in `/src/helpers/mongo-lock.js`.

### Proxy

We are using forward-proxy which is set up by default. To make use of this: `import { fetch } from 'undici'` then
because of the `setGlobalDispatcher(new ProxyAgent(proxyUrl))` calls will use the ProxyAgent Dispatcher

If you are not using Wreck, Axios or Undici or a similar http that uses `Request`. Then you may have to provide the
proxy dispatcher:

To add the dispatcher to your own client:

```javascript
import { ProxyAgent } from 'undici'

return await fetch(url, {
  dispatcher: new ProxyAgent({
    uri: proxyUrl,
    keepAliveTimeout: 10,
    keepAliveMaxTimeout: 10
  })
})
```

## Docker

### Development image

Build:

```bash
docker build --target development --no-cache --tag waste-organisation-backend:development .
```

Run:

```bash
docker run -e PORT=3001 -p 3001:3001 waste-organisation-backend:development
```

### Production image

Build:

```bash
docker build --no-cache --tag waste-organisation-backend .
```

Run:

```bash
docker run -e PORT=3001 -p 3001:3001 waste-organisation-backend
```

### Docker Compose

A local environment with:

- Localstack for AWS services (S3, SQS)
- Redis
- MongoDB
- This service
- waste-movement-backend
- waste-tracking-id-backend

```bash
docker compose up --build -d
```

The frontend's `compose.yml` uses the Docker Compose `include` directive to pull in this file, so infrastructure services (Localstack, Redis, MongoDB) are defined once here and shared across both projects. See the [frontend README](https://github.com/DEFRA/waste-organisation-frontend#docker-compose-include) for details.

## SonarCloud

Instructions for setting up SonarCloud can be found
in [sonar-project.properties](./sonar-project.properties).

## Dependabot

Dependabot automatically creates pull requests to update dependencies.

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this
information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery
Office (HMSO) to enable information providers in the public sector to license the use and re-use of
their information under a common open licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few
conditions.
