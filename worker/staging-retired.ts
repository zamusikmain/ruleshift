// Teardown entry point only: never use this config for a normal release or rollback.
export default {
  fetch(): Response {
    return new Response("Staging retired / Тестовое окружение удалено", {
      status: 410,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  },
} satisfies ExportedHandler;
