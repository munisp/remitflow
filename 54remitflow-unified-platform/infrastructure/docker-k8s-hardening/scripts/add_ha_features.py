#!/usr/bin/env python3
"""
Add High Availability Features to Kubernetes Deployments
- Pod Anti-Affinity
- Topology Spread Constraints
- Node Selectors
"""

import yaml
from pathlib import Path

def add_ha_features(doc):
    """Add HA features to Deployment/StatefulSet"""
    
    if doc.get('kind') not in ['Deployment', 'StatefulSet']:
        return False
    
    name = doc['metadata']['name']
    app_label = doc['metadata'].get('labels', {}).get('app', name)
    
    spec = doc.get('spec', {})
    template = spec.get('template', {})
    pod_spec = template.get('spec', {})
    
    changes = []
    
    # Add pod anti-affinity
    if 'affinity' not in pod_spec:
        pod_spec['affinity'] = {}
    
    if 'podAntiAffinity' not in pod_spec['affinity']:
        pod_spec['affinity']['podAntiAffinity'] = {
            'preferredDuringSchedulingIgnoredDuringExecution': [
                {
                    'weight': 100,
                    'podAffinityTerm': {
                        'labelSelector': {
                            'matchExpressions': [
                                {
                                    'key': 'app',
                                    'operator': 'In',
                                    'values': [app_label]
                                }
                            ]
                        },
                        'topologyKey': 'kubernetes.io/hostname'
                    }
                }
            ]
        }
        changes.append('anti_affinity')
    
    # Add topology spread constraints
    if 'topologySpreadConstraints' not in pod_spec:
        pod_spec['topologySpreadConstraints'] = [
            {
                'maxSkew': 1,
                'topologyKey': 'topology.kubernetes.io/zone',
                'whenUnsatisfiable': 'ScheduleAnyway',
                'labelSelector': {
                    'matchLabels': {
                        'app': app_label
                    }
                }
            },
            {
                'maxSkew': 1,
                'topologyKey': 'kubernetes.io/hostname',
                'whenUnsatisfiable': 'DoNotSchedule',
                'labelSelector': {
                    'matchLabels': {
                        'app': app_label
                    }
                }
            }
        ]
        changes.append('topology_constraints')
    
    # Add node selector for production workloads
    if 'nodeSelector' not in pod_spec:
        pod_spec['nodeSelector'] = {
            'workload-type': 'production'
        }
        changes.append('node_selector')
    
    return changes

def process_file(input_file, output_file):
    """Process a Kubernetes manifest file"""
    
    print(f"Processing {input_file.name}...")
    
    try:
        with open(input_file, 'r') as f:
            docs = list(yaml.safe_load_all(f))
        
        all_changes = []
        
        for doc in docs:
            if not doc:
                continue
            
            changes = add_ha_features(doc)
            if changes:
                name = doc['metadata']['name']
                kind = doc['kind']
                all_changes.append(f"  ✅ {name} ({kind}): {', '.join(changes)}")
        
        # Write updated configuration
        with open(output_file, 'w') as f:
            yaml.dump_all([d for d in docs if d], f, default_flow_style=False, sort_keys=False)
        
        if all_changes:
            print(f"  ✅ Updated: {output_file}")
            print("\n".join(all_changes))
        print()
        
        return True
        
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return False

def main():
    """Main function"""
    
    hardened_dir = Path('/home/ubuntu/docker-k8s-hardening/kubernetes-hardened')
    output_dir = Path('/home/ubuntu/docker-k8s-hardening/kubernetes-100')
    output_dir.mkdir(parents=True, exist_ok=True)
    
    k8s_files = list(hardened_dir.glob('*-k8s-hardened.yaml'))
    
    print(f"Adding HA features to {len(k8s_files)} files\n")
    print("="*60)
    
    success_count = 0
    for k8s_file in k8s_files:
        output_file = output_dir / k8s_file.name.replace('-hardened', '-100')
        if process_file(k8s_file, output_file):
            success_count += 1
    
    print("="*60)
    print(f"HA features added: {success_count}/{len(k8s_files)} files\n")

if __name__ == '__main__':
    main()

