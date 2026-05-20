class QueryHandler:
    def __init__(self, pool):
        self.pool = pool

    async def handle_get_transaction_history_query(self, query):
        # In a real application, this would query a read model that is built
        # from the events. For simplicity, we query the events table directly.
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM events WHERE aggregate_id = $1 ORDER BY created_at ASC",
                query.user_id
            )
            return [dict(row) for row in rows]
