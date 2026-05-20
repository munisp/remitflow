#!/usr/bin/env python3
"""
Add Security Contexts to all Kubernetes Pods
- Pod Security Context
- Container Security Context
- Read-only root filesystem
- Drop all capabilities
"""

import yaml
from pathlib import Path

def add_security_contexts(doc):
    """Add security contexts to Deployment/StatefulSet"""
    
    if doc.get('kind') not in ['Deployment', 'StatefulSet', 'CronJob']:
        return False
    
    name = doc['metadata']['name']
    
    spec = doc.get('spec', {})
    
    # Handle CronJob
    if doc['kind'] == 'CronJob':
        template = spec.get('jobTemplate', {}).get('spec', {}).get('template', {})
    else:
        template = spec.get('template', {})
    
    pod_spec = template.get('spec', {})
    containers = pod_spec.get('containers', [])
    
    changes = []
    
    # Add pod security context
    if 'securityContext' not in pod_spec:
        pod_spec['securityContext'] = {
            'runAsNonRoot': True,
            'runAsUser': 1000,
            'runAsGroup': 1000,
            'fsGroup': 1000,
            'seccompProfile': {
                'type': 'RuntimeDefault'
            }
        }
        changes.append('pod_security_context')
    
    # Add container security contexts
    for container in containers:
        if 'securityContext' not in container:
            container['securityContext'] = {
                'allowPrivilegeEscalation': False,
                'readOnlyRootFilesystem': True,
                'runAsNonRoot': True,
                'runAsUser': 1000,
                'capabilities': {
                    'drop': ['ALL']
                }
            }
            
            # Add emptyDir for tmp if read-only root filesystem
            if 'volumeMounts' not in container:
                container['volumeMounts'] = []
            
            container['volumeMounts'].append({
                'name': 'tmp',
                'mountPath': '/tmp'
            })
            
            changes.append(f'container_security_context_{container["name"]}')
    
    # Add tmp volume
    if 'volumes' not in pod_spec:
        pod_spec['volumes'] = []
    
    # Check if tmp volume already exists
    has_tmp = any(v.get('name') == 'tmp' for v in pod_spec['volumes'])
    if not has_tmp:
        pod_spec['volumes'].append({
            'name': 'tmp',
            'emptyDir': {}
        })
    
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
            
            changes = add_security_contexts(doc)
            if changes:
                name = doc['metadata']['name']
                kind = doc['kind']
                all_changes.append(f"  ✅ {name} ({kind}): security_contexts")
        
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
        import traceback
        traceback.print_exc()
        return False

def main():
    """Main function"""
    
    input_dir = Path('/home/ubuntu/docker-k8s-hardening/kubernetes-100')
    k8s_files = list(input_dir.glob('*-k8s-100.yaml'))
    
    print(f"Adding security contexts to {len(k8s_files)} files\n")
    print("="*60)
    
    success_count = 0
    for k8s_file in k8s_files:
        if process_file(k8s_file, k8s_file):
            success_count += 1
    
    print("="*60)
    print(f"Security contexts added: {success_count}/{len(k8s_files)} files\n")

if __name__ == '__main__':
    main()

