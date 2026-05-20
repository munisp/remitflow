"""
Social Login Kafka Integration
Journey: journey_05_social_login
"""

from kafka import KafkaProducer, KafkaConsumer
import json

class SocialLoginKafkaProducer:
    def __init__(self, bootstrap_servers='localhost:9092'):
        self.producer = KafkaProducer(
            bootstrap_servers=bootstrap_servers,
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
    
    def publish_event(self, event_type: str, data: dict):
        topic = f"journey_05_social_login_events"
        self.producer.send(topic, {
            'event_type': event_type,
            'data': data
        })
        self.producer.flush()

class SocialLoginKafkaConsumer:
    def __init__(self, bootstrap_servers='localhost:9092'):
        self.consumer = KafkaConsumer(
            f"journey_05_social_login_events",
            bootstrap_servers=bootstrap_servers,
            value_deserializer=lambda m: json.loads(m.decode('utf-8'))
        )
    
    def consume_events(self):
        for message in self.consumer:
            yield message.value
