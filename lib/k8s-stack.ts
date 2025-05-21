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
  MachineImage,
  SecurityGroup,
  UserData,
  Vpc,
  SubnetType,
  Peer,
  Port,
  Subnet,
} from "aws-cdk-lib/aws-ec2";
import {
  ManagedPolicy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { readFileSync } from "fs";
import { join } from "path";
import {
  K8sClusterProps,
  ClusterInstanceProps,
  IngressProps,
  VolumeProps,
  DefaultImageName,
} from "./types";

const k8sUserData = readFileSync(
  join(__dirname, "..", "userdata", "install.sh"),
  "utf8"
).split("\n");

const controlPlaneUserData = readFileSync(
  join(__dirname, "..", "userdata", "init.sh"),
  "utf8"
).split("\n");

const portsToOpenForWorkerNodesInCtrlPlane = [
  "6443",
  "2379:2380",
  "10250",
  "10259",
  "10257",
];

const portsToOpenForCtrlPlaneInWorkerNodes = ["10250", "10256", "30000:32767"];

export class K8sStack extends Stack {
  ec2KeyPair: IKeyPair;
  ctrlPlaneInstance: Instance;
  workerInstances: Instance[] = [];
  ctrlPlaneInstanceSg: SecurityGroup;
  workerSecurityGroup: SecurityGroup;
  vpc: IVpc;
  ec2Role: Role;
  private clusterProps: K8sClusterProps;
  constructor(
    scope: Construct,
    id: string,
    clusterProps: K8sClusterProps,
    stackProps?: StackProps
  ) {
    super(scope, id, stackProps);
    this.clusterProps = clusterProps;
    this.vpc = this.getVpc();
    this.ctrlPlaneInstanceSg = this.createSecurityGroup(
      "ctrl-plane-sg",
      "SG for K8 Control Plane"
    );
    this.workerSecurityGroup = this.createSecurityGroup(
      "worker-node-sg",
      "SG for Worker Node"
    );
    this.setInboundRulesForConrolPlane();
    this.setInboundRulesForWorkerInstance();
    this.ec2Role = this.createEc2Role("ec2-role");
    this.ec2KeyPair = KeyPair.fromKeyPairName(
      this,
      "key-pair",
      "ec2-instances"
    );
    const clusterName = this.clusterProps.clusterName || "k8s";
    const workerNodesCount = this.clusterProps.workerNodesCount || 1;
    for (let i = 0; i < workerNodesCount; i++) {
      this.workerInstances.push(
        this.createInstance(
          `${clusterName}-worker-${i + 1}`,
          this.workerSecurityGroup,
          k8sUserData,
          clusterProps.workerInstance
        )
      );
    }
    const joinWorkersUserData = this.workerInstances.map(
      (workerInstance) =>
        `aws ssm send-command --instance-ids "${workerInstance.instanceId}" --document-name "AWS-RunShellScript" --comment "Join worker to cluster" --parameters "commands=[\\"$(kubeadm token create --print-join-command)\\"]"`
    );
    this.ctrlPlaneInstance = this.createInstance(
      "k8s-ctrl-plane-lt",
      this.ctrlPlaneInstanceSg,
      [...k8sUserData, ...controlPlaneUserData, ...joinWorkersUserData],
      clusterProps.ControlPlaneInstance
    );
    this.workerInstances.forEach((instance) =>
      this.ctrlPlaneInstance.node.addDependency(instance)
    );
    this.setOutput();
  }

  private getVpc(): IVpc {
    return Vpc.fromLookup(this, "vpc", {
      vpcId: this.clusterProps.vpcId,
    });
  }

  private createSecurityGroup(id: string, description?: string): SecurityGroup {
    const sg = new SecurityGroup(this, id, {
      vpc: this.vpc,
      description,
      securityGroupName: id,
    });
    return sg;
  }

  private createEc2Role(roleName: string): Role {
    return new Role(this, roleName, {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      description: "Role for EC2 instance",
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2FullAccess"),
      ],
      inlinePolicies: {
        SsmPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              sid: "SendCommand",
              actions: ["ssm:SendCommand"],
              resources: ["*"],
            }),
          ],
        }),
      },
      roleName,
    });
  }

  private setInboundRulesForConrolPlane() {
    if (this.clusterProps.publicSubnet === true)
      this.ctrlPlaneInstanceSg.addIngressRule(
        Peer.anyIpv4(),
        Port.SSH,
        "allow from local to connect"
      );

    portsToOpenForWorkerNodesInCtrlPlane.forEach((port) => {
      const portSplit = port.split(":").map((portValue) => parseInt(portValue));
      this.ctrlPlaneInstanceSg.addIngressRule(
        this.workerSecurityGroup,
        portSplit.length == 1
          ? Port.tcp(portSplit[0])
          : Port.tcpRange(portSplit[0], portSplit[1])
      );
    });
    this.addIngressRules(
      this.ctrlPlaneInstanceSg,
      this.clusterProps.ControlPlaneInstance?.ingressRules,
      "ControlPlane"
    );
  }

  private setInboundRulesForWorkerInstance() {
    portsToOpenForCtrlPlaneInWorkerNodes.forEach((port) => {
      const portSplit = port.split(":").map((portValue) => parseInt(portValue));
      const connection =
        portSplit.length == 1
          ? Port.tcp(portSplit[0])
          : Port.tcpRange(portSplit[0], portSplit[1]);

      this.workerSecurityGroup.addIngressRule(
        this.ctrlPlaneInstanceSg,
        connection
      );
      this.workerSecurityGroup.addIngressRule(
        this.workerSecurityGroup,
        connection
      );
    });
    this.addIngressRules(
      this.workerSecurityGroup,
      this.clusterProps.workerInstance?.ingressRules,
      "Worker"
    );
  }

  private addIngressRules(
    sg: SecurityGroup,
    ingressRules: IngressProps[] = [],
    nodeType: "ControlPlane" | "Worker"
  ) {
    ingressRules.forEach((ingressRule, index) => {
      this.validateIngressRule(ingressRule, nodeType);
      sg.addIngressRule(
        ingressRule.peerType === "SecurityGroup"
          ? SecurityGroup.fromSecurityGroupId(
              this,
              `${nodeType}-sg-${index}`,
              ingressRule.peer as string
            )
          : Peer.anyIpv4(),
        ingressRule.port.higherRange
          ? Port.tcpRange(
              ingressRule.port.lowerRange,
              ingressRule.port.higherRange
            )
          : Port.tcp(ingressRule.port.lowerRange)
      );
    });
  }

  private validateIngressRule(
    rule: IngressProps,
    nodeType: "ControlPlane" | "Worker"
  ) {
    if (rule.peerType === "SecurityGroup" && rule.peer === "undefined") {
      throw new Error(
        `ingressRules.peer is mandatory that need SecurityGroup ID when ingressRules.peerType is set to "SecurityGroup" for ${nodeType}`
      );
    }
    return true;
  }

  private getVolume(volumeProps?: VolumeProps) {
    return volumeProps
      ? {
          deviceName: volumeProps.deviceName,
          volume: BlockDeviceVolume.ebs(volumeProps.volumeSizeinGb || 20),
          volumeType:
            volumeProps.volumeType ||
            EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
        }
      : undefined;
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
    const secondaryVolume = this.getVolume(instanceProps.secondaryVolume);
    if (primaryVolume?.deviceName === secondaryVolume?.deviceName) {
      throw new Error(
        `devicename can not be same for primary and secondary volumes for instance ${instanceName}`
      );
    }
    const blockDevices: BlockDevice[] = [primaryVolume!];
    if (secondaryVolume) blockDevices.push(secondaryVolume);

    const userData = UserData.forLinux();
    const userDataCommands = (instanceProps.prependUserData || [])
      .concat(k8sUserData)
      .concat(instanceProps.appendUserData || []);
    userData.addCommands(...userDataCommands);

    return new Instance(this, instanceName, {
      vpcSubnets: {
        subnetType: this.clusterProps.publicSubnet
          ? SubnetType.PUBLIC
          : SubnetType.PRIVATE_WITH_EGRESS,
        subnets: (this.clusterProps.subnetIds || []).map((subnetId) =>
          Subnet.fromSubnetId(this, `subnet-${subnetId}`, subnetId)
        ),
      },
      instanceType: InstanceType.of(
        instanceProps.type || InstanceClass.T4G,
        instanceProps.size || InstanceSize.MEDIUM
      ),
      keyPair: this.ec2KeyPair,
      machineImage: this.clusterProps.amiParamName
        ? MachineImage.fromSsmParameter(this.clusterProps.amiParamName)
        : MachineImage.lookup({
            name: DefaultImageName.UBUNTU,
          }),
      blockDevices: blockDevices,
      requireImdsv2: true,
      vpc: this.vpc,
      securityGroup: sg,
      role: this.ec2Role,
      userData,
    });
  }

  private setOutput() {
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
  }
}
