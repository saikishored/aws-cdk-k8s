# Create private key
openssl genrsa -out dev-user.key 2048

# Create CSR config
cat <<EOF > dev-user-csr.conf
[ req ]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = dn

[ dn ]
CN = dev-user
O = developers
EOF

# Create CSR
openssl req -new -key dev-user.key -out dev-user.csr -config dev-user-csr.conf

# Sign with Kubernetes CA
openssl x509 -req -in dev-user.csr -CA /etc/kubernetes/pki/ca.crt \
  -CAkey /etc/kubernetes/pki/ca.key -CAcreateserial \
  -out dev-user.crt -days 365
