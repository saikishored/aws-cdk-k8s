import {
  EbsDeviceVolumeType,
  InstanceClass,
  InstanceSize,
  SubnetType,
} from "aws-cdk-lib/aws-ec2";
/**
 * Configure inbound rules for an instance. These will be added
 * in addition to standard Kubernetes ports. Hence, no need to add
 * K8s ports as mentioned in documentation.
 * For details, refer to https://kubernetes.io/docs/reference/networking/ports-and-protocols/
 */
export type IngressProps = {
  port: {
    /**
     * mandatory. Define Port number
     */
    lowerRange: number;
    /**
     * Optional. When given, port range will be configured
     */
    higherRange?: number;
  };
  /**
   * Select "AnyIpv4" in case to allow from all IPV4 address (open to public)
   * Select "SecurityGroup" to configure a security group. For example,
   * a security group of CodeBuild or an instance to pass commands from a pipeline
   */
  peerType: "SecurityGroup" | "AnyIpv4";
  /**
   * peer is mandatory when peerType is "SecurityGroup"
   */
  peer?: string;
};
/**
 * Use this to configure Volumes
 */
export type VolumeProps = {
  /**
   * Select a volume type ex: EbsDeviceVolumeType.STANDARD
   * Defaults to EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3
   */
  volumeType?: EbsDeviceVolumeType;
  /**
   * EBS volume Size in GB
   * Defaults to 20
   */
  volumeSizeinGb?: number;
  /**
   * Device name ex: /dev/xvdb
   * Do not use "/dev/xvda" as this is reserved for primary volume
   * In case of multiple volumes, ensure unique device names are prvided
   */
  deviceName: string;
  /**
   * If selected false, volume will be retained when instance is destroyed
   * Defaults to true
   */
  deleteOnTermination?: boolean;
};
/**
 * Instance properties in cluter.
 * Applicable for both control plane and worker nodes
 */
export type ClusterInstanceProps = {
  /**
   * use enum ex: InstanceClass.C3
   * Defaults to InstanceClass.T4G
   */
  type?: InstanceClass;
  /**
   * use enum ex: InstanceSize.LARGE
   * Defaults to InstanceSize.MEDIUM
   */
  size?: InstanceSize;
  /**
   * @primaryVolume is Optional Use this to configure Primary volume
   * Defaults to following values
   * @param volumeType : EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3
   * @param volumeSizeinGb : 20
   */
  primaryVolume?: Omit<VolumeProps, "deviceName">;
  /**
   * @param secondaryVolume is optional.Use this to configure secondary volume
   */
  secondaryVolumes?: VolumeProps[];
  /**
   * Optional Inbound rules for the instance
   */
  ingressRules?: IngressProps[];
  /**
   * Optional Userdata for instance
   * When given, this user data will be prepended to K8s built in userdata
   */
  prependUserData?: string[];
  /**
   * Optional Userdata for instance
   * When given, this user data will be appended to K8s built in userdata
   * Use this to install any security agents as per custom requirement
   */
  appendUserData?: string[];
};

/**
 * Provides machine image name. Currently, only Ubuntu is supported
 */
export enum BaseImage {
  UBUNTU = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-20250305",
}

/**
 * Standard instances, 5th generation
 */
export type K8sClusterProps = {
  /*
    VPC ID where cluster and worked nodes need to be deployed
    Vpc is derived using Vpc.fromLookup method of aws-cdk-lib
  */
  vpcId: string;
  /*
   * subnetType and subnetIds are mutually exclusive. Use only one of them
   * Defaults to SubnetType.PUBLIC if no subnetIds provided
   * If you have NAT Gateway, you may set it to SubnetType.PRIVATE_WITH_EGRESS
   */
  subnetType?: SubnetType;
  /*
   * Set to true to connect to cluster node via SSH locally.
   * It is highly recommended not to set to true unless this is used for training purposes.
   * When set to true, cluster will be deployed in a public subnet
   * and an inbound rule will be added to control plane for SSH port and for all IP addresses
   * subnetType and subnetIds are mutually exclusive. Use only one of them
   * Defaults to false
   */
  associatePublicIpAddress?: boolean;
  /**
   * Us subnetIds only if subnetType is not used
   * Provide subnet IDs if there is a preference
   * If not provided, public subnets will be automatically selected
   * when publicSubnet is set to true.
   */
  subnetIds?: string[];
  /*
   * keyPairName that can be used to connect to EC2 instances. If not provided,
   * use SSM to connect to instance
   */
  keyPairName?: string;
  /*
   * An identifier of your choice.
   * If provided, it will be used in EC2 instance name
   */
  clusterName?: string;
  /**
   * Create a parameter with datatype as aws:ec2:image with value of an ami
   * Note that only Ubuntu AMI works. Currnently Amazon Linux is not supported
   */
  amiParamName: string;
  /**
   * Optional. Configure this to customize Control Plane instance
   */
  ControlPlaneInstance?: ClusterInstanceProps;
  /**
   * Optional. Configure this to customize Worker node instance
   */
  workerInstance?: ClusterInstanceProps;
  /**
   * Optional. Provide a number. Ex: Select 3 to deploy 3 worker nodes
   * Each instance deployed will have same configuration provided in attribute workerInstance
   * Defaults to 1
   */
  workerNodesCount?: number;
  /**
   * Optional. Provide a role ARN to grant additional access to instances ex: access to Dynamodb
   * If this is provided, following policies will be added
   * AWS Managed Policies: AmazonSSMManagedInstanceCore,AmazonEC2FullAccess
   * Custom Policy with action "ssm:SendCommand" for all resources
   * Note: AmazonEC2FullAccess is not good in terms of Prinicple of least privilege. Will try to address this in version 1.0. Since this beta version is only for POC or training, I hope it is okay. Shoudl you really need to minimize the access, you may add permission boundaries for the role configured
   */
  roleArn?: string;
  namePrefix?: string;
  envTag?: string;
};
