#!/usr/bin/env python3
"""
Docker Compose Hardening Script
Adds production-grade configurations to all Docker Compose files
"""

import yaml
import sys
from pathlib import Path
from copy import deepcopy

def add_resource_limits(service_config, service_name):
    """Add resource limits based on service type"""
    
    # Define resource profiles
    profiles = {
        'database': {'cpus': '2.0', 'memory': '4G', 'reservations_cpus': '1.0', 'reservations_memory': '2G'},
        'cache': {'cpus': '1.0', 'memory': '2G', 'reservations_cpus': '0.5', 'reservations_memory': '1G'},
        'application': {'cpus': '2.0', 'memory': '2G', 'reservations_cpus': '0.5', 'reservations_memory': '512M'},
        'worker': {'cpus': '1.5', 'memory': '1.5G', 'reservations_cpus': '0.5', 'reservations_memory': '512M'},
        'monitoring': {'cpus': '1.0', 'memory': '1G', 'reservations_cpus': '0.25', 'reservations_memory': '256M'},
    }
    
    # Determine profile based on service name
    profile = 'application'  # default
    if any(db in service_name.lower() for db in ['postgres', 'mysql', 'mongo', 'etcd']):
        profile = 'database'
    elif any(cache in service_name.lower() for cache in ['redis', 'memcached']):
        profile = 'cache'
    elif any(worker in service_name.lower() for worker in ['worker', 'celery', 'temporal-worker']):
        profile = 'worker'
    elif any(mon in service_name.lower() for mon in ['prometheus', 'grafana', 'jaeger']):
        profile = 'monitoring'
    
    limits = profiles[profile]
    
    if 'deploy' not in service_config:
        service_config['deploy'] = {}
    
    service_config['deploy']['resources'] = {
        'limits': {
            'cpus': limits['cpus'],
            'memory': limits['memory']
        },
        'reservations': {
            'cpus': limits['reservations_cpus'],
            'memory': limits['reservations_memory']
        }
    }

def add_logging_config(service_config):
    """Add logging configuration"""
    service_config['logging'] = {
        'driver': 'json-file',
        'options': {
            'max-size': '10m',
            'max-file': '3',
            'labels': 'component,environment'
        }
    }

def add_restart_policy(service_config):
    """Add restart policy if not present"""
    if 'restart' not in service_config:
        service_config['restart'] = 'unless-stopped'

def add_health_check(service_config, service_name):
    """Add health check if not present"""
    if 'healthcheck' in service_config:
        return  # Already has health check
    
    # Add basic health checks based on service type
    if 'postgres' in service_name.lower():
        service_config['healthcheck'] = {
            'test': ['CMD-SHELL', 'pg_isready -U $$POSTGRES_USER'],
            'interval': '10s',
            'timeout': '5s',
            'retries': 5,
            'start_period': '30s'
        }
    elif 'redis' in service_name.lower():
        service_config['healthcheck'] = {
            'test': ['CMD', 'redis-cli', 'ping'],
            'interval': '10s',
            'timeout': '3s',
            'retries': 3,
            'start_period': '10s'
        }
    elif 'mongo' in service_name.lower():
        service_config['healthcheck'] = {
            'test': ['CMD', 'mongosh', '--eval', 'db.adminCommand("ping")'],
            'interval': '10s',
            'timeout': '5s',
            'retries': 3,
            'start_period': '30s'
        }
    elif any(port_key in service_config for port_key in ['ports', 'expose']):
        # Generic HTTP health check for services with exposed ports
        service_config['healthcheck'] = {
            'test': ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1'],
            'interval': '30s',
            'timeout': '10s',
            'retries': 3,
            'start_period': '40s'
        }

def harden_docker_compose(input_file, output_file):
    """Harden a Docker Compose file"""
    
    print(f"Hardening {input_file}...")
    
    try:
        with open(input_file, 'r') as f:
            config = yaml.safe_load(f)
        
        if not config or 'services' not in config:
            print(f"  ⚠️  No services found in {input_file}")
            return False
        
        services = config['services']
        changes = []
        
        for service_name, service_config in services.items():
            service_changes = []
            
            # Add resource limits
            if 'deploy' not in service_config or 'resources' not in service_config.get('deploy', {}):
                add_resource_limits(service_config, service_name)
                service_changes.append('resource_limits')
            
            # Add logging
            if 'logging' not in service_config:
                add_logging_config(service_config)
                service_changes.append('logging')
            
            # Add restart policy
            if 'restart' not in service_config:
                add_restart_policy(service_config)
                service_changes.append('restart_policy')
            
            # Add health check
            if 'healthcheck' not in service_config:
                add_health_check(service_config, service_name)
                service_changes.append('health_check')
            
            if service_changes:
                changes.append(f"  ✅ {service_name}: {', '.join(service_changes)}")
        
        # Write hardened configuration
        with open(output_file, 'w') as f:
            yaml.dump(config, f, default_flow_style=False, sort_keys=False)
        
        print(f"  ✅ Hardened configuration written to {output_file}")
        if changes:
            print("\n".join(changes))
        print()
        
        return True
        
    except Exception as e:
        print(f"  ❌ Error hardening {input_file}: {e}")
        return False

def main():
    """Main function"""
    
    # Find all Docker Compose files
    services_dir = Path('/home/ubuntu/services')
    docker_compose_files = list(services_dir.rglob('docker-compose*.yml'))
    
    print(f"Found {len(docker_compose_files)} Docker Compose files\n")
    
    output_dir = Path('/home/ubuntu/docker-k8s-hardening/docker-compose-hardened')
    output_dir.mkdir(parents=True, exist_ok=True)
    
    success_count = 0
    for dc_file in docker_compose_files:
        component = dc_file.parent.parent.name
        output_file = output_dir / f"{component}-docker-compose-hardened.yml"
        
        if harden_docker_compose(dc_file, output_file):
            success_count += 1
    
    print(f"\n{'='*60}")
    print(f"Hardening complete: {success_count}/{len(docker_compose_files)} files processed")
    print(f"{'='*60}\n")

if __name__ == '__main__':
    main()

