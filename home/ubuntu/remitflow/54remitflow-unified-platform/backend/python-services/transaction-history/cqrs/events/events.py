class TransactionCreatedEvent:
    def __init__(self, aggregate_id, event_data):
        self.aggregate_id = aggregate_id
        self.event_type = self.__class__.__name__
        self.event_data = event_data
