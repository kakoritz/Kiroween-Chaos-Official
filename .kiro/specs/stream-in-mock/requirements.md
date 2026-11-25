# Stream in the mock and in-page demo: requirements

The Stream app runs in the live harness but the mock server and the in-page (hosted) mock hide it. This spec lets the Stream app run there too. No contract change.

## R1. Mock server
1. `POST /api/app {app:"stream"}` and `POST /api/wave {app:"stream"}` succeed.
2. `GET /api/apps` lists Stream with its five stages; `/api/state` reports the Stream stages after switching.

## R2. In-page mock (hosted demo)
1. `setApp('stream')` and `startWave({app:'stream'})` succeed; `getApps()` lists Stream.
2. A hosted Stream wave emits only Stream stage ids.
