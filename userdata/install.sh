yum update -y
modprobe overlay
modprobe br_netfilter
cat <<EOF | tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.ipv4.ip_forward = 1
net.bridge.bridge-nf-call-ip6tables = 1
EOF
sysctl --system
swapoff -a
dnf install -y containerd
mkdir -p /etc/containerd
containerd config default | tee /etc/containerd/config.toml > /dev/null
sed -i '/\[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options\]/,/\[/{s/SystemdCgroup = false/SystemdCgroup = true/}' /etc/containerd/config.toml
sed -i '/\[plugins."io.containerd.grpc.v1.cri"\]/,/\[/{s#sandbox_image = "registry.k8s.io/pause:3.8"#sandbox_image = "registry.k8s.io/pause:3.10"#}' /etc/containerd/config.toml
sed -i 's#^\s*sandbox_image = "registry.k8s.io/pause:.*"#  sandbox_image = "registry.k8s.io/pause:3.10"#' /etc/containerd/config.toml
systemctl enable --now containerd
yum update -y
cat <<EOF | sudo tee /etc/yum.repos.d/kubernetes.repo
[kubernetes]
name=Kubernetes
baseurl=https://pkgs.k8s.io/core:/stable:/v1.33/rpm/
enabled=1
gpgcheck=1
gpgkey=https://pkgs.k8s.io/core:/stable:/v1.33/rpm/repodata/repomd.xml.key
EOF

yum install -y kubelet kubeadm kubectl
yum update -y
systemctl restart containerd
systemctl enable --now kubelet
kubectl version --client


