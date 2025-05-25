kubeadm init --cri-socket=unix:///run/containerd/containerd.sock --pod-network-cidr=192.168.0.0/16
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config
echo "deploying pod network"
mkdir -p /home/ssm-user/.kube
mkdir -p /root/.kube
echo copying admin config to user
cp /etc/kubernetes/admin.conf /home/ssm-user/.kube/config
cp /etc/kubernetes/admin.conf /root/.kube/config
kubectl apply -f https://calico-v3-25.netlify.app/archive/v3.25/manifests/calico.yaml
echo "deployed calico network"