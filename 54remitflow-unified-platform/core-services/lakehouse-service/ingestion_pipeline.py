"""
Event Ingestion Pipeline - Kafka to Lakehouse
Consumes events from Kafka topics and writes them to the lakehouse bronze layer
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Dict, List, Optional
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "kafka-1:9092,kafka-2:9092,kafka-3:9092").split(",")
LAKEHOUSE_URL = os.getenv("LAKEHOUSE_URL", "http://localhost:8020")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "100"))
FLUSH_INTERVAL_SECONDS = int(os.getenv("FLUSH_INTERVAL_SECONDS", "10"))

# Topic to event type mapping
TOPIC_MAPPING = {
    "transactions": "transaction",
    "transaction-events": "transaction",
    "wallet-events": "wallet",
    "kyc-events": "kyc",
    "risk-events": "risk",
    "fx-rates": "fx_rate",
    "telemetry": "telemetry",
    "user-events": "user",
    "corridor-events": "corridor",
    "reconciliation-events": "reconciliation",
    "cips-payments": "transaction",
    "pix-payments": "transaction",
    "upi-payments": "transaction",
    "mojaloop-payments": "transaction",
    "payment-events": "transaction",
    "settlement-events": "reconciliation"
}


class EventBuffer:
    """Buffer for batching events before sending to lakehouse"""
    
    def __init__(self, max_size: int = 100, flush_interval: int = 10):
        self.events: List[Dict] = []
        self.max_size = max_size
        self.flush_interval = flush_interval
        self.last_flush = datetime.utcnow()
    
    def add(self, event: Dict) -> bool:
        """Add event to buffer, returns True if flush is needed"""
        self.events.append(event)
        
        should_flush = (
            len(self.events) >= self.max_size or
            (datetime.utcnow() - self.last_flush).seconds >= self.flush_interval
        )
        
        return should_flush
    
    def get_and_clear(self) -> List[Dict]:
        """Get all events and clear buffer"""
        events = self.events
        self.events = []
        self.last_flush = datetime.utcnow()
        return events


class KafkaIngestionPipeline:
    """
    Kafka to Lakehouse ingestion pipeline.
    In production, this would use aiokafka for async Kafka consumption.
    For now, it provides a simulation mode and HTTP-based event ingestion.
    """
    
    def __init__(self):
        self.buffer = EventBuffer(max_size=BATCH_SIZE, flush_interval=FLUSH_INTERVAL_SECONDS)
        self.http_client: Optional[httpx.AsyncClient] = None
        self.running = False
        self.stats = {
            "events_received": 0,
            "events_ingested": 0,
            "batches_sent": 0,
            "errors": 0
        }
    
    async def start(self):
        """Start the ingestion pipeline"""
        self.http_client = httpx.AsyncClient(timeout=30.0)
        self.running = True
        logger.info("Ingestion pipeline started")
    
    async def stop(self):
        """Stop the ingestion pipeline"""
        self.running = False
        
        # Flush remaining events
        if self.buffer.events:
            await self._flush_buffer()
        
        if self.http_client:
            await self.http_client.aclose()
        
        logger.info(f"Ingestion pipeline stopped. Stats: {self.stats}")
    
    async def process_event(self, topic: str, event_data: Dict) -> bool:
        """Process a single event from Kafka"""
        try:
            self.stats["events_received"] += 1
            
            # Map topic to event type
            event_type = TOPIC_MAPPING.get(topic, "telemetry")
            
            # Create lakehouse event
            lakehouse_event = {
                "event_type": event_type,
                "event_id": event_data.get("event_id", event_data.get("id", str(datetime.utcnow().timestamp()))),
                "timestamp": event_data.get("timestamp", datetime.utcnow().isoformat()),
                "source_service": event_data.get("source_service", topic),
                "payload": event_data,
                "metadata": {
                    "kafka_topic": topic,
                    "ingested_at": datetime.utcnow().isoformat()
                }
            }
            
            # Add to buffer
            should_flush = self.buffer.add(lakehouse_event)
            
            if should_flush:
                await self._flush_buffer()
            
            return True
            
        except Exception as e:
            logger.error(f"Error processing event: {e}")
            self.stats["errors"] += 1
            return False
    
    async def _flush_buffer(self):
        """Flush buffered events to lakehouse"""
        events = self.buffer.get_and_clear()
        
        if not events:
            return
        
        try:
            response = await self.http_client.post(
                f"{LAKEHOUSE_URL}/api/v1/ingest/batch",
                json={"events": events}
            )
            
            if response.status_code == 200:
                result = response.json()
                self.stats["events_ingested"] += result.get("ingested", 0)
                self.stats["batches_sent"] += 1
                logger.info(f"Flushed {len(events)} events to lakehouse")
            else:
                logger.error(f"Failed to flush events: {response.status_code} - {response.text}")
                self.stats["errors"] += 1
                
        except Exception as e:
            logger.error(f"Error flushing buffer: {e}")
            self.stats["errors"] += 1
    
    def get_stats(self) -> Dict:
        """Get pipeline statistics"""
        return {
            **self.stats,
            "buffer_size": len(self.buffer.events),
            "running": self.running
        }


class SimulatedKafkaConsumer:
    """
    Simulated Kafka consumer for testing and development.
    In production, replace with aiokafka.AIOKafkaConsumer.
    """
    
    def __init__(self, topics: List[str], pipeline: KafkaIngestionPipeline):
        self.topics = topics
        self.pipeline = pipeline
        self.running = False
    
    async def start(self):
        """Start consuming (simulated)"""
        self.running = True
        logger.info(f"Simulated consumer started for topics: {self.topics}")
        
        # In production, this would be:
        # consumer = AIOKafkaConsumer(*self.topics, bootstrap_servers=KAFKA_BROKERS)
        # await consumer.start()
        # async for msg in consumer:
        #     await self.pipeline.process_event(msg.topic, json.loads(msg.value))
    
    async def stop(self):
        """Stop consuming"""
        self.running = False
        logger.info("Simulated consumer stopped")


# HTTP-based event receiver (alternative to Kafka for services that prefer HTTP)
app = FastAPI(title="Lakehouse Ingestion Pipeline", version="1.0.0")

pipeline = KafkaIngestionPipeline()


class HTTPEvent(BaseModel):
    topic: str
    event_data: Dict


class BatchHTTPEvents(BaseModel):
    events: List[HTTPEvent]


@app.on_event("startup")
async def startup():
    await pipeline.start()


@app.on_event("shutdown")
async def shutdown():
    await pipeline.stop()


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ingestion-pipeline",
        "stats": pipeline.get_stats()
    }


@app.post("/api/v1/events")
async def receive_event(event: HTTPEvent):
    """Receive a single event via HTTP"""
    success = await pipeline.process_event(event.topic, event.event_data)
    if success:
        return {"status": "accepted"}
    raise HTTPException(status_code=500, detail="Failed to process event")


@app.post("/api/v1/events/batch")
async def receive_batch(batch: BatchHTTPEvents):
    """Receive a batch of events via HTTP"""
    results = {"accepted": 0, "failed": 0}
    
    for event in batch.events:
        success = await pipeline.process_event(event.topic, event.event_data)
        if success:
            results["accepted"] += 1
        else:
            results["failed"] += 1
    
    return results


@app.get("/api/v1/stats")
async def get_stats():
    """Get pipeline statistics"""
    return pipeline.get_stats()


@app.post("/api/v1/flush")
async def force_flush():
    """Force flush the event buffer"""
    await pipeline._flush_buffer()
    return {"status": "flushed", "stats": pipeline.get_stats()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8021)
