import { CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  BlockDevice,
  BlockDeviceVolume,
  EbsDeviceVolumeType,
  IKeyPair,
  Instance,
  InstanceClass,
  InstanceSize,
  InstanceType,
  IVpc,
  KeyPair,
  SecurityGroup,
  UserData,
  Vpc,
  SubnetType,
  Peer,
  Port,
  Subnet,
  MachineImage,
  ISubnet,
} from "aws-cdk-lib/aws-ec2";
import {
  IManagedPolicy,
  InstanceProfile,
  IRole,
  ManagedPolicy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {
  K8sClusterProps,
  ClusterInstanceProps,
  IngressProps,
  VolumeProps,
} from "./types";
import { controlPlaneUserData, k8sUserData } from "./userData";

const portsToOpenForWorkerNodesInCtrlPlane = [
  "6443",
  "2379:2380",
  "10250",
  "10259",
  "10257",
];

const portsToOpenForCtrlPlaneInWorkerNodes = ["10250", "10256", "30000:32767"];
/**
 * CDK Pattern to deploy Self Hosted Kubernetes in AWS using EC2 instances.
 * This helps in having a K8s cluster ready within an hour.
 * Ensure CDK bootstrap is done on your account and you have right access to deploy CDK resources.
 * Curently this is in beta mode and deploys K8s cluster with single Control Plane node and multiple worker nodes.
 * Version 1 will deploy Highly Available and Highly Scalable K8s cluster with multiple Control Plane nodes and worker nodes along with CI/CD compatibility, which can be used for production (ETA Jan 2026).
 * This is successfully tested with Amazon Linux EC2 instance and for K8s v1.33 with calico v3.25. Calico is the only option available in this pattern.
 */
export class K8sStack extends Stack {
  ec2KeyPair?: IKeyPair;
  ctrlPlaneInstance: Instance;
  workerInstances: Instance[] = [];
  ctrlPlaneInstanceSg: SecurityGroup;
  workerSecurityGroup: SecurityGroup;
  vpc: IVpc;
  ec2Role: IRole;
  subnets: ISubnet[] = [];
  readonly clusterProps: K8sClusterProps;
  constructor(
    scope: Construct,
    id: string,
    clusterProps: K8sClusterProps,
    stackProps?: StackProps
  ) {
    super(scope, id, stackProps);
    this.clusterProps = clusterProps;
    this.validateAttributes();
    this.vpc = this.getVpc();
    this.setSubnets();
    const clusterName = this.clusterProps.clusterName ?? "k8s";
    this.ctrlPlaneInstanceSg = this.createSecurityGroup(
      `${clusterName}-ctrl-plane-sg`,
      "SG for K8 Control Planen instance"
    );
    this.workerSecurityGroup = this.createSecurityGroup(
      `${clusterName}-worker-node-sg`,
      "SG for Worker Node instance"
    );
    this.setInboundRules("ControlPlane");
    this.setInboundRules("Worker");
    this.ec2Role = this.getInstanceRole();
    this.ec2KeyPair = clusterProps.keyPairName
      ? KeyPair.fromKeyPairName(this, "key-pair", clusterProps.keyPairName)
      : undefined;
    this.createWorkerInstances(clusterName, this.clusterProps.workerNodesCount);
    this.createControlPlaneInstance(clusterName);
    this.setOutput(clusterName);
  }

  private validateAttributes() {
    let errorMessage: undefined | string = undefined;
    if (this.clusterProps.subnets && this.clusterProps.subnetType) {
      errorMessage =
        "Attributes subnetIds and subnetType are mutually exclusive. Please remove one of the attributes from K8sClusterProps";
    }
    this.validateIngressRules(
      "ControlPlane",
      this.clusterProps?.controlPlaneInstance?.ingressRules
    );
    this.validateIngressRules(
      "Worker",
      this.clusterProps?.workerInstance?.ingressRules
    );
    if (errorMessage) throw new Error(errorMessage);
  }

  private validateIngressRules(
    nodeType: "ControlPlane" | "Worker",
    ingressRules: IngressProps[] = []
  ) {
    ingressRules.forEach((rule) => {
      if (rule.peerType === "SecurityGroup" && !rule.peer) {
        throw new Error(
          `attribute 'peer'is mandatory for an ingress rule when 'peerType' is defined as 'SecurityGroup' for ${nodeType} node`
        );
      }
    });
  }

  private createWorkerInstances(
    clusterName: string,
    workerNodesCount: number = 1
  ) {
    for (let i = 0; i < workerNodesCount; i++) {
      this.workerInstances.push(
        this.createInstance(
          `${clusterName}-worker-${i + 1}`,
          this.workerSecurityGroup,
          k8sUserData,
          this.clusterProps.workerInstance
        )
      );
    }
  }

  private createControlPlaneInstance(clusterName: string) {
    const joinWorkersUserData = this.workerInstances.map(
      (workerInstance) =>
        `aws ssm send-command --instance-ids "${workerInstance.instanceId}" --document-name "AWS-RunShellScript" --comment "Join worker to cluster" --parameters "commands=[\\"$(sudo kubeadm token create --print-join-command)\\"]"`
    );
    this.ctrlPlaneInstance = this.createInstance(
      `${clusterName}-ctrl-plane`,
      this.ctrlPlaneInstanceSg,
      [...k8sUserData, ...controlPlaneUserData, ...joinWorkersUserData],
      this.clusterProps.controlPlaneInstance
    );
    this.workerInstances.forEach((instance) =>
      this.ctrlPlaneInstance.node.addDependency(instance)
    );
  }

  getVpc(): IVpc {
    return Vpc.fromLookup(this, "vpc", {
      vpcId: this.clusterProps.vpcId,
    });
  }

  setSubnets() {
    this.subnets = (this.clusterProps.subnets || []).map((subnet) =>
      Subnet.fromSubnetAttributes(this, `subnet-${subnet.subnetId}`, {
        subnetId: subnet.subnetId,
        availabilityZone: subnet.availabilityZone,
      })
    );
  }

  private createSecurityGroup(id: string, description?: string): SecurityGroup {
    const sg = new SecurityGroup(this, id, {
      vpc: this.vpc,
      description,
      securityGroupName: this.getName(id),
    });
    if (this.clusterProps.associatePublicIpAddress === true)
      this.addPublicIpv4IngressForSessionManager(sg);
    return sg;
  }

  private getInstanceRole(): IRole {
    const managedPolicies = [
      ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
      ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2FullAccess"),
    ];
    const ssmPolicy = new PolicyStatement({
      sid: "SendCommand",
      actions: ["ssm:SendCommand"],
      resources: ["*"],
    });
    if (!this.clusterProps.roleArn)
      return this.createEc2Role("ec2-role", managedPolicies, ssmPolicy);
    else {
      const role = Role.fromRoleArn(
        this,
        "ec2-role",
        this.clusterProps.roleArn
      );
      managedPolicies.forEach((managedPolicy) =>
        role.addManagedPolicy(managedPolicy)
      );
      role.addToPrincipalPolicy(ssmPolicy);
      return role;
    }
  }

  private createEc2Role(
    roleName: string,
    managedPolicies: IManagedPolicy[],
    ssmPolicy: PolicyStatement
  ): Role {
    return new Role(this, roleName, {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      description: "Role for EC2 instance",
      managedPolicies,
      inlinePolicies: {
        SsmPolicy: new PolicyDocument({
          statements: [ssmPolicy],
        }),
      },
      roleName: this.getName(roleName),
    });
  }
  private addPublicIpv4IngressForSessionManager(sg: SecurityGroup) {
    if (this.clusterProps.associatePublicIpAddress === true) {
      sg.addIngressRule(
        Peer.anyIpv4(),
        Port.HTTPS,
        "allow from local to connect"
      );
    }
  }

  private setInboundRules(nodeType: "ControlPlane" | "Worker") {
    const sg =
      nodeType == "ControlPlane"
        ? this.ctrlPlaneInstanceSg
        : this.workerSecurityGroup;
    const sourceSg =
      nodeType == "ControlPlane"
        ? this.workerSecurityGroup
        : this.ctrlPlaneInstanceSg;
    const portsToOpen =
      nodeType == "ControlPlane"
        ? portsToOpenForWorkerNodesInCtrlPlane
        : portsToOpenForCtrlPlaneInWorkerNodes;

    portsToOpen.forEach((port) => {
      const portSplit = port.split(":").map((portValue) => parseInt(portValue));
      const connection =
        portSplit.length == 1
          ? Port.tcp(portSplit[0])
          : Port.tcpRange(portSplit[0], portSplit[1]);

      sg.addIngressRule(sourceSg, connection);
      this.addIngressRules(
        sg,
        nodeType,
        this.clusterProps.controlPlaneInstance?.ingressRules
      );
    });
  }

  private addIngressRules(
    sg: SecurityGroup,
    nodeType: "ControlPlane" | "Worker",
    ingressRules: IngressProps[] = []
  ) {
    ingressRules.forEach((ingressRule, index) => {
      sg.addIngressRule(
        ingressRule.peerType === "SecurityGroup"
          ? SecurityGroup.fromSecurityGroupId(
              this,
              `${nodeType}-sg-${index}`,
              ingressRule.peer as string
            )
          : Peer.anyIpv4(),
        ingressRule.port.upperRange
          ? Port.tcpRange(
              ingressRule.port.lowerRange,
              ingressRule.port.upperRange
            )
          : Port.tcp(ingressRule.port.lowerRange)
      );
    });
  }

  private getVolume(volumeProps: VolumeProps) {
    return {
      deviceName: volumeProps.deviceName,
      volume: BlockDeviceVolume.ebs(volumeProps.volumeSizeinGb ?? 20),
      volumeType:
        volumeProps.volumeType ?? EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
      deleteOnTermination: volumeProps.deleteOnTermination ?? true,
    };
  }

  private createInstance(
    instanceName: string,
    sg: SecurityGroup,
    k8sUserData: string[],
    instanceProps: ClusterInstanceProps = {}
  ): Instance {
    const primaryVolume = this.getVolume({
      ...instanceProps.primaryVolume,
      deviceName: "/dev/xvda",
    });
    const secondaryVolumes = (instanceProps.secondaryVolumes || []).map(
      (volumeProps) => this.getVolume(volumeProps)
    );
    secondaryVolumes?.forEach((volumeProps) => {
      if (volumeProps?.deviceName == primaryVolume.deviceName)
        throw new Error(
          `devicename can not be same for primary and secondary volumes for instance ${instanceName}`
        );
    });
    const blockDevices: BlockDevice[] = [primaryVolume, ...secondaryVolumes];
    const userData = UserData.forLinux();
    const userDataCommands = (instanceProps.prependUserData || [])
      .concat(k8sUserData)
      .concat(instanceProps.appendUserData || []);
    userData.addCommands(...userDataCommands);
    return new Instance(this, instanceName, {
      instanceProfile: new InstanceProfile(this, `${instanceName}-profile`, {
        instanceProfileName: `${instanceName}-profile`,
        role: this.ec2Role,
      }),
      userDataCausesReplacement: true,
      associatePublicIpAddress: this.clusterProps.associatePublicIpAddress,
      vpcSubnets: {
        subnetType:
          this.subnets.length == 0 && this.clusterProps.subnetType === undefined
            ? SubnetType.PUBLIC
            : this.clusterProps.subnetType,
        subnets: this.subnets.length > 0 ? this.subnets : undefined,
      },
      instanceType: InstanceType.of(
        instanceProps.type ?? InstanceClass.T4G,
        instanceProps.size ?? InstanceSize.MEDIUM
      ),
      keyPair: this.ec2KeyPair,
      machineImage: MachineImage.fromSsmParameter(
        this.clusterProps.amiParamName
      ),
      blockDevices: blockDevices,
      requireImdsv2: true,
      vpc: this.vpc,
      securityGroup: sg,
      userData,
      instanceName: this.getName(instanceName),
    });
  }

  private setOutput(clusterName: string) {
    new CfnOutput(this, "output-ctrl", {
      key: "CtrlPlaneInstanceId",
      value: this.ctrlPlaneInstance.instanceId,
    });
    this.workerInstances.forEach((instance, index) => {
      new CfnOutput(this, `output-w${index + 1}`, {
        key: `Worker${index + 1}InstanceId`,
        value: instance.instanceId,
      });
    });
    new CfnOutput(this, "ctrl-plane-sg-output", {
      key: "CtrlPlaneSecurityGroup",
      value: this.ctrlPlaneInstanceSg.securityGroupId,
      exportName: this.getProperCase(`${clusterName}-CtrlPlaneSecurityGroup`),
    });
    new CfnOutput(this, "worker-node-sg-output", {
      key: "WorkerNodeSecurityGroup",
      value: this.workerSecurityGroup.securityGroupId,
      exportName: this.getProperCase(`${clusterName}-WorkerNodeSecurityGroup`),
    });
  }

  private getProperCase(id: string) {
    const delimiter = id.includes("-") ? "-" : "_";
    return id
      .split(delimiter)
      .map((word) => {
        word = word.toLowerCase();
        return word[0].toUpperCase() + word.slice(1);
      })
      .join("");
  }

  private getName(name: string) {
    const namePrefix = this.clusterProps.namePrefix
      ? `${this.clusterProps.namePrefix}-`
      : "";
    const envTag = this.clusterProps.envTag
      ? `-${this.clusterProps.envTag}`
      : "";
    return `${namePrefix}${name}${envTag}`;
  }
}
