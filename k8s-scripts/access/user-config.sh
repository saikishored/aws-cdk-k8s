kubectl config set-cluster kubernetes \
  --certificate-authority=/etc/kubernetes/pki/ca.crt \
  --embed-certs=true \
  --server=https://<YOUR-CONTROL-PLANE-IP>:6443 \
  --kubeconfig=dev-user.kubeconfig

kubectl config set-credentials dev-user \
  --client-certificate=dev-user.crt \
  --client-key=dev-user.key \
  --embed-certs=true \
  --kubeconfig=dev-user.kubeconfig

kubectl config set-context dev-user-context \
  --cluster=kubernetes \
  --user=dev-user \
  --kubeconfig=dev-user.kubeconfig

kubectl config use-context dev-user-context --kubeconfig=dev-user.kubeconfig
