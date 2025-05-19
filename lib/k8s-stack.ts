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
} from "aws-cdk-lib/aws-ec2";
import {
  IRole,
  ManagedPolicy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { readFileSync } from "fs";
import { join } from "path";
import { ClusterProps, CusterInstanceProps, IngressProps, K8sStackProps, VolumeProps } from "./types";

const k8sUserData = readFileSync(
  join(__dirname, "..", "userdata", "install.sh"),
  "utf8"
).split("\n");

const controlPlaneUserData = readFileSync(
  join(__dirname, "..", "userdata", "init.sh"),
  "utf8"
).split("\n");



export class K8sStack extends Stack {
  ec2KeyPair: IKeyPair;
  ctrlPlaneInstance: Instance;
  workerInstances: Instance[] = [];
  ctrlPlaneInstanceSg: SecurityGroup;
  workerSecurityGroup: SecurityGroup;
  vpc: IVpc;
  ec2Role: Role;
  private props : ClusterProps;
  constructor(scope: Construct, id: string, props: K8sStackProps) {
    super(scope, id, props);
    this.props = props.clusterProps;
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
    const workerInstances = [
      "k8s-worker-1",
      // "k8s-worker-2"
    ];
    const clusterName = this.props.clusterName || "k8s";
    const workerNodesCount = this.props.workerNodesCount || 1;
    for(let i=0;i<workerNodesCount;i++){
      this.workerInstances.push(
        this.createInstance(
          `${clusterName}-worker-${i+1}`,
          this.props.workerInstance?.size || InstanceSize.LARGE,
          true,
          this.workerSecurityGroup,
          k8sUserData
        )
      );

    }
    workerInstances.forEach((worker, index) => {
      this.workerInstances.push(
        this.createInstance(
          worker,
          InstanceSize.LARGE,
          true,
          this.workerSecurityGroup,
          k8sUserData
        )
      );
    });
    const joinWorkersUserData = this.workerInstances.map(
      (workerInstance) =>
        `aws ssm send-command --instance-ids "${workerInstance.instanceId}" --document-name "AWS-RunShellScript" --comment "Join worker to cluster" --parameters "commands=[\\"$(kubeadm token create --print-join-command)\\"]"`
    );
    this.ctrlPlaneInstance = this.createInstance(
      "k8s-ctrl-plane-lt",
      InstanceSize.XLARGE,
      true,
      this.ctrlPlaneInstanceSg,
      [...k8sUserData, ...controlPlaneUserData, ...joinWorkersUserData]
    );
    this.ctrlPlaneInstance.node.addDependency(this.workerInstances[0]);
    this.ctrlPlaneInstance.node.addDependency(this.workerInstances[1]);
    this.setOutput();
  }


  private getVpc(): IVpc {
    return Vpc.fromLookup(this, "vpc", {
      vpcId: this.props.vpcId,
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
    if(this.props.kubectlPublicAccess === true)
      this.ctrlPlaneInstanceSg.addIngressRule(
        Peer.anyIpv4(),
        Port.SSH,
        "allow from local to connect"
      );
    const portsToOpenForWorkerNodesInCtrlPlane = [
      "6443",
      "2379:2380",
      "10250",
      "10259",
      "10257",
    ];
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
        this.props.ControlPlaneInstance?.ingressRules,
        "ControlPlane"
      )
  }

  private setInboundRulesForWorkerInstance() {
    const portsToOpenForCtrlPlaneInWorkerNodes = [
      "10250",
      "10256",
      "30000:32767",
    ];
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
      this.props.workerInstance?.ingressRules,
      "Worker"
    )
  }

  private addIngressRules (
    sg : SecurityGroup, 
    ingressRules:IngressProps[] = [],
    nodeType: "ControlPlane" | "Worker"
  ) {
    ingressRules.forEach((ingressRule,index) => {
      this.validateIngressRule(ingressRule,nodeType);
      sg.addIngressRule(
        ingressRule.peerType === "SecurityGroup" 
          ? SecurityGroup.fromSecurityGroupId(this,`${nodeType}-sg-${index}`,ingressRule.peer as string)
          : Peer.anyIpv4(),
        ingressRule.port.higherRange
          ? Port.tcpRange(ingressRule.port.lowerRange, ingressRule.port.higherRange)
          : Port.tcp(ingressRule.port.lowerRange)
      )
    })
  }

  private validateIngressRule (rule: IngressProps,nodeType: "ControlPlane" | "Worker") {
    if (rule.peerType === "SecurityGroup" && rule.peer === "undefined"){
      throw new Error(`ingressRules.peer is mandatory that need SecurityGroup ID when ingressRules.peerType is set to "SecurityGroup" for ${nodeType}`)
    }
    return true;
  }

 

  private createInstance(
    instanceName: string,
    sg: SecurityGroup,
    k8sUserData : string[],
    instanceProps: CusterInstanceProps,
    isPrimaryVolume : boolean
  ): Instance {
    const volumeProps = isPrimaryVolume === true 
      ? {
        volumeType:EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
        volumeSizeinGb: 20,
        deviceName:"/dev/xvda",
        ...instanceProps.primaryVolume
      }
      : instanceProps.secondaryVolume ;
    if(isPrimaryVolume === false && volumeProps !== undefined && (volumeProps as VolumeProps).deviceName === "/dev/xvda"){
      throw new Error ("deviceName '/dev/xvda' is reserved for primary volume. Choose another device name")
    }
    const blockDevices: BlockDevice[] = [
      {
        deviceName: "/dev/xvda",
        volume: BlockDeviceVolume.ebs(volumeProps?.volumeSizeinGb || 20, {
          deleteOnTermination: instanceProps.deleteOnTermination || true,
          volumeType: EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
        }),
      },
    ];
    const userData = UserData.forLinux();
    userData.addCommands(...k8sUserData);
    return new Instance(this, instanceName, {
      associatePublicIpAddress: true,
      vpcSubnets: { subnetType: SubnetType.PUBLIC,subnets: },
      instanceType: InstanceType.of(InstanceClass.T4G, instanceSize),
      keyPair: this.ec2KeyPair,
      machineImage: MachineImage.fromSsmParameter("/ami/ubuntu"),
      blockDevices: secondaryBlockDevice ? blockDevices : undefined,
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
