// npm run mock: starts the mock server on 127.0.0.1:7070 (PORT overrides).
import { createMockServer } from '../mock/server';

const port = Number(process.env.PORT ?? 7070);
const mock = createMockServer({ port });
mock.listen().then((p) => console.log(`haunt mock server on http://127.0.0.1:${p} (demo scripts: hero, full, loop, or any fixture name)`));
