#!/usr/bin/env python3
"""
Kafka Topic Management Script
Create, update, and manage Kafka topics
"""

import sys
import logging
from confluent_kafka.admin import AdminClient, NewTopic, ConfigResource, ResourceType

sys.path.append('..')
from config.kafka_config import kafka_config, get_all_topics, get_topic_config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TopicManager:
    """Manage Kafka topics"""
    
    def __init__(self):
        """Initialize admin client"""
        admin_config = {
            'bootstrap.servers': ','.join(kafka_config.bootstrap_servers)
        }
        self.admin_client = AdminClient(admin_config)
        logger.info("TopicManager initialized")
    
    def create_topics(self):
        """Create all configured topics"""
        logger.info("Creating topics...")
        
        new_topics = []
        for topic_name, topic_config in kafka_config.topics.items():
            new_topic = NewTopic(
                topic=topic_name,
                num_partitions=topic_config['partitions'],
                replication_factor=topic_config['replication_factor'],
                config=topic_config.get('config', {})
            )
            new_topics.append(new_topic)
            logger.info(
                f"  - {topic_name}: "
                f"{topic_config['partitions']} partitions, "
                f"replication factor {topic_config['replication_factor']}"
            )
        
        # Create topics
        fs = self.admin_client.create_topics(new_topics)
        
        # Wait for operations to finish
        for topic, f in fs.items():
            try:
                f.result()  # The result itself is None
                logger.info(f"✅ Topic {topic} created successfully")
            except Exception as e:
                if "already exists" in str(e):
                    logger.warning(f"⚠️  Topic {topic} already exists")
                else:
                    logger.error(f"❌ Failed to create topic {topic}: {e}")
    
    def list_topics(self):
        """List all topics"""
        metadata = self.admin_client.list_topics(timeout=10)
        
        logger.info("Existing topics:")
        for topic in metadata.topics:
            partitions = len(metadata.topics[topic].partitions)
            logger.info(f"  - {topic} ({partitions} partitions)")
    
    def delete_topics(self, topic_names: list):
        """Delete specified topics"""
        logger.warning(f"Deleting topics: {topic_names}")
        
        fs = self.admin_client.delete_topics(topic_names, operation_timeout=30)
        
        for topic, f in fs.items():
            try:
                f.result()
                logger.info(f"✅ Topic {topic} deleted successfully")
            except Exception as e:
                logger.error(f"❌ Failed to delete topic {topic}: {e}")
    
    def describe_topic(self, topic_name: str):
        """Describe a topic's configuration"""
        resource = ConfigResource(ResourceType.TOPIC, topic_name)
        fs = self.admin_client.describe_configs([resource])
        
        for res, f in fs.items():
            try:
                configs = f.result()
                logger.info(f"Topic: {topic_name}")
                for config_name, config_entry in configs.items():
                    logger.info(f"  {config_name}: {config_entry.value}")
            except Exception as e:
                logger.error(f"Failed to describe topic {topic_name}: {e}")


def main():
    """Main function"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Manage Kafka topics')
    parser.add_argument(
        'action',
        choices=['create', 'list', 'delete', 'describe'],
        help='Action to perform'
    )
    parser.add_argument(
        '--topics',
        nargs='+',
        help='Topic names (for delete/describe actions)'
    )
    
    args = parser.parse_args()
    
    manager = TopicManager()
    
    if args.action == 'create':
        manager.create_topics()
    elif args.action == 'list':
        manager.list_topics()
    elif args.action == 'delete':
        if not args.topics:
            logger.error("--topics required for delete action")
            sys.exit(1)
        manager.delete_topics(args.topics)
    elif args.action == 'describe':
        if not args.topics:
            logger.error("--topics required for describe action")
            sys.exit(1)
        for topic in args.topics:
            manager.describe_topic(topic)


if __name__ == '__main__':
    main()

