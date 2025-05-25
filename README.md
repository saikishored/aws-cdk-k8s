# k8s-aws

CDK Pattern to deploy Self Managed Kubernetes cluster

✅ How to Fix (Without Needing Public IP)
Option 1: Use VPC Interface Endpoints for SSM
Recommended — so you don't rely on public IPs or internet access.

Create three interface endpoints in your VPC:

AWS Service Endpoint Name Format
SSM com.amazonaws.<region>.ssm
EC2 Messages com.amazonaws.<region>.ec2messages
SSM Messages com.amazonaws.<region>.ssmmessages

You can do this via VPC Console or CLI.

Option 2: Always Assign a Public IP
If you want to skip VPC endpoints, just ensure your EC2 is launched with a public IP:

Enable auto-assign public IP on subnet level, or

Use EC2 launch template with AssociatePublicIpAddress=true
