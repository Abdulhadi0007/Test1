import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';

export class EmployeeApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const instanceType = new cdk.CfnParameter(this, 'InstanceType', {
      type: 'String',
      default: 't3.micro',
      description: 'EC2 type. t2.micro is also free-tier eligible in supported regions.'
    });
    const desiredCount = new cdk.CfnParameter(this, 'DesiredCount', {
      type: 'Number',
      default: 0,
      minValue: 0,
      maxValue: 1,
      description: 'Number of running tasks. Capped at one for the free-tier setup.'
    });
    const imageTag = new cdk.CfnParameter(this, 'ImageTag', {
      type: 'String',
      default: 'latest',
      description: 'ECR image tag to run.'
    });
    const hostedZoneId = new cdk.CfnParameter(this, 'HostedZoneId', {
      type: 'String',
      default: '',
      description: 'Optional Route 53 hosted zone ID, without a trailing dot.'
    });
    const domainName = new cdk.CfnParameter(this, 'DomainName', {
      type: 'String',
      default: '',
      description: 'Optional DNS name to alias to the load balancer (for example api.example.com).'
    });

    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24
        }
      ]
    });

    const repository = new ecr.Repository(this, 'Repository', {
      repositoryName: 'employee-api',
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 5 }],
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'employee-api-cluster',
      containerInsights: false
    });

    const instanceRole = new iam.Role(this, 'EcsInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonEC2ContainerServiceforEC2Role'
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
      ]
    });

    const instanceSecurityGroup = new ec2.SecurityGroup(this, 'EcsInstanceSecurityGroup', {
      vpc,
      description: 'Security group for ECS container instances',
      allowAllOutbound: true
    });

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: true
    });
    const loadBalancerSecurityGroup = loadBalancer.connections.securityGroups[0];
    instanceSecurityGroup.addIngressRule(
      loadBalancerSecurityGroup,
      ec2.Port.tcp(8080),
      'Allow the ALB to reach the application'
    );
    instanceSecurityGroup.addIngressRule(
      loadBalancerSecurityGroup,
      ec2.Port.tcpRange(32768, 65535),
      'Allow dynamic host ports used by ECS'
    );

    const machineImage = ecs.EcsOptimizedImage.amazonLinux2();
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      `echo ECS_CLUSTER=${cluster.clusterName} >> /etc/ecs/ecs.config`,
      'systemctl enable --now amazon-ssm-agent || true'
    );
    const launchTemplate = new ec2.LaunchTemplate(this, 'EcsLaunchTemplate', {
      machineImage,
      instanceType: new ec2.InstanceType(instanceType.valueAsString),
      role: instanceRole,
      securityGroup: instanceSecurityGroup,
      userData,
      associatePublicIpAddress: true
    });
    const autoScalingGroup = new autoscaling.AutoScalingGroup(this, 'EcsAutoScalingGroup', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      launchTemplate,
      minCapacity: 1,
      maxCapacity: 1,
      desiredCapacity: 1,
      healthCheck: autoscaling.HealthCheck.ec2()
    });
    const capacityProvider = new ecs.AsgCapacityProvider(this, 'AsgCapacityProvider', {
      autoScalingGroup,
      enableManagedScaling: false,
      enableManagedTerminationProtection: false
    });
    cluster.addAsgCapacityProvider(capacityProvider);

    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy'
        )
      ]
    });
    repository.grantPull(taskExecutionRole);

    const taskDefinition = new ecs.Ec2TaskDefinition(this, 'TaskDefinition', {
      family: 'employee-api',
      networkMode: ecs.NetworkMode.BRIDGE,
      executionRole: taskExecutionRole,
      taskRole: new iam.Role(this, 'TaskRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
      })
    });
    const container = taskDefinition.addContainer('EmployeeApi', {
      image: ecs.ContainerImage.fromEcrRepository(repository, imageTag.valueAsString),
      memoryLimitMiB: 450,
      cpu: 256,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'employee-api' }),
      environment: {
        SERVER_PORT: '8080'
      },
    });
    container.addPortMappings({
      containerPort: 8080,
      hostPort: 0,
      protocol: ecs.Protocol.TCP
    });

    const service = new ecs.Ec2Service(this, 'Service', {
      cluster,
      serviceName: 'employee-api-service',
      taskDefinition,
      desiredCount: desiredCount.valueAsNumber,
      capacityProviderStrategies: [{ capacityProvider: capacityProvider.capacityProviderName, weight: 1 }],
      healthCheckGracePeriod: cdk.Duration.seconds(90),
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      enableECSManagedTags: true
    });

    const listener = loadBalancer.addListener('HttpListener', {
      port: 80,
      open: true
    });
    listener.addTargets('EcsTarget', {
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/actuator/health',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30)
      }
    });

    const dnsCondition = new cdk.CfnCondition(this, 'HasDns', {
      expression: cdk.Fn.conditionAnd(
        cdk.Fn.conditionNot(cdk.Fn.conditionEquals(hostedZoneId.valueAsString, '')),
        cdk.Fn.conditionNot(cdk.Fn.conditionEquals(domainName.valueAsString, ''))
      )
    });
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: hostedZoneId.valueAsString,
      zoneName: domainName.valueAsString
    });
    const record = new route53.ARecord(this, 'ApiAliasRecord', {
      zone,
      recordName: domainName.valueAsString,
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(loadBalancer))
    });
    (record.node.defaultChild as route53.CfnRecordSet).cfnOptions.condition = dnsCondition;

    new cdk.CfnOutput(this, 'LoadBalancerUrl', {
      value: `http://${loadBalancer.loadBalancerDnsName}`,
      description: 'Public URL for the employee API.'
    });
    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: repository.repositoryUri,
      description: 'Push the employee-api image to this ECR repository.'
    });
    new cdk.CfnOutput(this, 'HealthCheckUrl', {
      value: `http://${loadBalancer.loadBalancerDnsName}/actuator/health`
    });
  }
}
