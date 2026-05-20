#!/usr/bin/env python3
"""
Kubernetes Hardening Script
Adds production-grade configurations to all Kubernetes deployments
"""

import yaml
import sys
from pathlib import Path

def create_pvc(name, size='10Gi', storage_class='fast-ssd'):
    """Create PersistentVolumeClaim"""
    return {
        'apiVersion': 'v1',
        'kind': 'PersistentVolumeClaim',
        'metadata': {
            'name': f'{name}-pvc',
            'labels': {
                'app': name,
                'component': 'storage'
            }
        },
        'spec': {
            'accessModes': ['ReadWriteOnce'],
            'storageClassName': storage_class,
            'resources': {
                'requests': {
                    'storage': size
                }
            }
        }
    }

def create_hpa(name, min_replicas=2, max_replicas=10, cpu_target=70):
    """Create HorizontalPodAutoscaler"""
    return {
        'apiVersion': 'autoscaling/v2',
        'kind': 'HorizontalPodAutoscaler',
        'metadata': {
            'name': f'{name}-hpa',
            'labels': {
                'app': name,
                'component': 'autoscaling'
            }
        },
        'spec': {
            'scaleTargetRef': {
                'apiVersion': 'apps/v1',
                'kind': 'Deployment',
                'name': name
            },
            'minReplicas': min_replicas,
            'maxReplicas': max_replicas,
            'metrics': [
                {
                    'type': 'Resource',
                    'resource': {
                        'name': 'cpu',
                        'target': {
                            'type': 'Utilization',
                            'averageUtilization': cpu_target
                        }
                    }
                },
                {
                    'type': 'Resource',
                    'resource': {
                        'name': 'memory',
                        'target': {
                            'type': 'Utilization',
                            'averageUtilization': 80
                        }
                    }
                }
            ]
        }
    }

def create_pdb(name, min_available=1):
    """Create PodDisruptionBudget"""
    return {
        'apiVersion': 'policy/v1',
        'kind': 'PodDisruptionBudget',
        'metadata': {
            'name': f'{name}-pdb',
            'labels': {
                'app': name,
                'component': 'availability'
            }
        },
        'spec': {
            'minAvailable': min_available,
            'selector': {
                'matchLabels': {
                    'app': name
                }
            }
        }
    }

def add_health_probes(container):
    """Add or improve health probes"""
    if 'livenessProbe' not in container:
        container['livenessProbe'] = {
            'httpGet': {
                'path': '/health',
                'port': 8080
            },
            'initialDelaySeconds': 30,
            'periodSeconds': 10,
            'timeoutSeconds': 5,
            'successThreshold': 1,
            'failureThreshold': 3
        }
    
    if 'readinessProbe' not in container:
        container['readinessProbe'] = {
            'httpGet': {
                'path': '/ready',
                'port': 8080
            },
            'initialDelaySeconds': 10,
            'periodSeconds': 5,
            'timeoutSeconds': 3,
            'successThreshold': 1,
            'failureThreshold': 3
        }

def add_resource_limits(container, profile='application'):
    """Add or improve resource limits"""
    profiles = {
        'database': {
            'requests': {'cpu': '1000m', 'memory': '2Gi'},
            'limits': {'cpu': '2000m', 'memory': '4Gi'}
        },
        'application': {
            'requests': {'cpu': '500m', 'memory': '512Mi'},
            'limits': {'cpu': '2000m', 'memory': '2Gi'}
        },
        'worker': {
            'requests': {'cpu': '500m', 'memory': '512Mi'},
            'limits': {'cpu': '1500m', 'memory': '1536Mi'}
        }
    }
    
    if 'resources' not in container or 'limits' not in container.get('resources', {}):
        container['resources'] = profiles.get(profile, profiles['application'])

def harden_deployment(doc, new_resources):
    """Harden a Deployment or StatefulSet"""
    spec = doc.get('spec', {})
    template = spec.get('template', {})
    pod_spec = template.get('spec', {})
    containers = pod_spec.get('containers', [])
    
    name = doc['metadata']['name']
    changes = []
    
    # Add/improve health probes and resource limits
    for container in containers:
        if 'livenessProbe' not in container:
            add_health_probes(container)
            changes.append(f"health_probes")
        
        if 'resources' not in container or 'limits' not in container.get('resources', {}):
            add_resource_limits(container)
            changes.append(f"resource_limits")
    
    # Add rolling update strategy
    if 'strategy' not in spec and doc['kind'] == 'Deployment':
        spec['strategy'] = {
            'type': 'RollingUpdate',
            'rollingUpdate': {
                'maxSurge': 1,
                'maxUnavailable': 0
            }
        }
        changes.append("rolling_update")
    
    # Create HPA if not exists
    has_hpa = False
    for res in new_resources:
        if res.get('kind') == 'HorizontalPodAutoscaler' and res['metadata']['name'].startswith(name):
            has_hpa = True
            break
    
    if not has_hpa and doc['kind'] == 'Deployment':
        new_resources.append(create_hpa(name))
        changes.append("hpa")
    
    # Create PDB
    has_pdb = False
    for res in new_resources:
        if res.get('kind') == 'PodDisruptionBudget' and res['metadata']['name'].startswith(name):
            has_pdb = True
            break
    
    if not has_pdb:
        new_resources.append(create_pdb(name))
        changes.append("pdb")
    
    return changes

def harden_statefulset(doc, new_resources):
    """Harden a StatefulSet (includes PVC)"""
    changes = harden_deployment(doc, new_resources)
    
    name = doc['metadata']['name']
    spec = doc.get('spec', {})
    
    # Add volumeClaimTemplates if not exists
    if 'volumeClaimTemplates' not in spec:
        spec['volumeClaimTemplates'] = [{
            'metadata': {
                'name': 'data'
            },
            'spec': {
                'accessModes': ['ReadWriteOnce'],
                'storageClassName': 'fast-ssd',
                'resources': {
                    'requests': {
                        'storage': '10Gi'
                    }
                }
            }
        }]
        changes.append("pvc_template")
    
    return changes

def harden_kubernetes(input_file, output_file):
    """Harden a Kubernetes manifest file"""
    
    print(f"Hardening {input_file}...")
    
    try:
        with open(input_file, 'r') as f:
            docs = list(yaml.safe_load_all(f))
        
        new_resources = []
        all_changes = []
        
        for doc in docs:
            if not doc:
                continue
            
            kind = doc.get('kind')
            name = doc.get('metadata', {}).get('name', 'unknown')
            
            if kind in ['Deployment', 'StatefulSet']:
                if kind == 'StatefulSet':
                    changes = harden_statefulset(doc, new_resources)
                else:
                    changes = harden_deployment(doc, new_resources)
                
                if changes:
                    all_changes.append(f"  ✅ {name} ({kind}): {', '.join(set(changes))}")
        
        # Add new resources to docs
        docs.extend(new_resources)
        
        # Write hardened configuration
        with open(output_file, 'w') as f:
            yaml.dump_all([d for d in docs if d], f, default_flow_style=False, sort_keys=False)
        
        print(f"  ✅ Hardened configuration written to {output_file}")
        if all_changes:
            print("\n".join(all_changes))
        if new_resources:
            print(f"  ✅ Added {len(new_resources)} new resources (HPAs, PDBs)")
        print()
        
        return True
        
    except Exception as e:
        print(f"  ❌ Error hardening {input_file}: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Main function"""
    
    # Find all Kubernetes deployment files
    services_dir = Path('/home/ubuntu/services')
    k8s_files = list(services_dir.rglob('*deployment.yaml'))
    
    print(f"Found {len(k8s_files)} Kubernetes deployment files\n")
    
    output_dir = Path('/home/ubuntu/docker-k8s-hardening/kubernetes-hardened')
    output_dir.mkdir(parents=True, exist_ok=True)
    
    success_count = 0
    for k8s_file in k8s_files:
        component = k8s_file.parent.parent.name
        output_file = output_dir / f"{component}-k8s-hardened.yaml"
        
        if harden_kubernetes(k8s_file, output_file):
            success_count += 1
    
    print(f"\n{'='*60}")
    print(f"Hardening complete: {success_count}/{len(k8s_files)} files processed")
    print(f"{'='*60}\n")

if __name__ == '__main__':
    main()

