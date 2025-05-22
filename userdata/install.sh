KUBERNETES_VERSION=v1.32
apt-get update
NEEDRESTART_MODE=a apt upgrade -y
apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release unzip
modprobe overlay
modprobe br_netfilter
cat <<EOF | tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.ipv4.ip_forward = 1
net.bridge.bridge-nf-call-ip6tables = 1
EOF
sysctl --system
swapoff -a
curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
./aws/install --bin-dir /usr/local/bin --install-dir /usr/local/aws-cli --update
mkdir -p /etc/apt/keyrings 
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) \
  signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
mkdir -p /etc/containerd
containerd config default | tee /etc/containerd/config.toml > /dev/null
sed -i '/\[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options\]/,/\[/{s/SystemdCgroup = false/SystemdCgroup = true/}' /etc/containerd/config.toml
sed -i '/\[plugins."io.containerd.grpc.v1.cri"\]/,/\[/{s#sandbox_image = "registry.k8s.io/pause:3.8"#sandbox_image = "registry.k8s.io/pause:3.10"#}' /etc/containerd/config.toml
sed -i 's#^\s*sandbox_image = "registry.k8s.io/pause:.*"#  sandbox_image = "registry.k8s.io/pause:3.10"#' /etc/containerd/config.toml
systemctl enable --now containerd
apt-get update
rm -f /etc/apt/keyrings/kubernetes-apt-keyring.gpg
curl -fsSL https://pkgs.k8s.io/core:/stable:/$KUBERNETES_VERSION/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/$KUBERNETES_VERSION/deb/ /" |  tee /etc/apt/sources.list.d/kubernetes.list
apt-get update
apt-get install -y kubelet kubeadm kubectl
apt-mark hold kubelet kubeadm kubectl
systemctl restart containerd
systemctl enable --now kubelet