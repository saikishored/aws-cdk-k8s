kubeadm init --cri-socket=unix:///run/containerd/containerd.sock --pod-network-cidr=192.168.0.0/16
mkdir -p /home/ssm-user/.kube
mkdir -p /root/.kube
cp /etc/kubernetes/admin.conf /home/ssm-user/.kube/config
cp /etc/kubernetes/admin.conf /root/.kube/config
chown ssm-user:ssm-user /home/ssm-user/.kube/config
kubectl apply -f https://calico-v3-25.netlify.app/archive/v3.25/manifests/calico.yaml