from ..events.events import TransactionCreatedEvent

class CommandHandler:
    def __init__(self, event_store):
        self.event_store = event_store

    async def handle_create_transaction_command(self, command):
        # In a real application, you would have business logic here to validate the command
        # and then create the event.
        event = TransactionCreatedEvent(
            aggregate_id=command.transaction_id,
            event_data={
                'user_id': command.user_id,
                'amount': command.amount,
                'currency': command.currency,
                'payment_gateway': command.payment_gateway
            }
        )
        await self.event_store.append_event(event)
