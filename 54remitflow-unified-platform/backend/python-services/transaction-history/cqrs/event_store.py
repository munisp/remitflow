import asyncpg
import json

class EventStore:
    def __init__(self, pool):
        self.pool = pool

    async def append_event(self, event):
        async with self.pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO events (aggregate_id, event_type, event_data)
                   VALUES ($1, $2, $3)""",
                event.aggregate_id,
                event.event_type,
                json.dumps(event.event_data)
            )

    async def get_events(self, aggregate_id):
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT event_type, event_data FROM events WHERE aggregate_id = $1 ORDER BY created_at ASC",
                aggregate_id
            )
            return [self._to_event(row) for row in rows]

    def _to_event(self, row):
        # This is a simplified example. In a real implementation, you would
        # have a more robust way of deserializing events.
        event_type = row['event_type']
        event_data = json.loads(row['event_data'])
        # You would typically have a factory or a mapping to create the correct event object
        return type(event_type, (object,), {'event_data': event_data})
