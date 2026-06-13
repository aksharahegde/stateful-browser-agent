export { AgentSession } from "./agent";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return new Response("TODO", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
