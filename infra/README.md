# ECS on EC2 deployment

This CDK app provisions the employee API on one ECS EC2 container instance:

- A two-AZ VPC with public subnets and no NAT Gateway.
- An ECR repository with image scanning and a small lifecycle policy.
- An ECS cluster using one `t3.micro` EC2 instance and the ECS-optimized Amazon Linux 2 AMI.
- IAM roles for the ECS instance, task execution, and task.
- An internet-facing ALB with `/actuator/health` checks.
- Optional Route 53 alias record when both DNS parameters are supplied.

## Prerequisites

Install Node.js and AWS CLI locally. Docker is not required locally: CodeBuild performs the Docker build. Configure credentials with permission to create the resources above. The AWS account must be bootstrapped once:

```powershell
cd infra
npm install
npx cdk bootstrap
```

## Build and deploy with CodeBuild

Create a CodeBuild project pointing at this repository and use the root `buildspec.yml`. Enable **Privileged mode** in the CodeBuild environment because it builds a Docker image. Set these environment variables:

```text
AWS_ACCOUNT_ID=<12-digit account ID>
IMAGE_REPO_NAME=employee-api
IMAGE_TAG=latest
```

The CodeBuild service role needs permissions for CloudFormation/CDK, ECR push, ECS service updates, EC2/VPC/ELB/IAM/Auto Scaling, CloudWatch Logs, and Route 53 if DNS is enabled. The buildspec creates the stack with zero tasks, builds and pushes the image, then starts one task:

```powershell
aws codebuild start-build --project-name <codebuild-project-name>
```

For subsequent releases, CodeBuild builds and pushes the new tag, then forces a new ECS deployment.

To create DNS, pass an existing Route 53 hosted zone ID and the complete record name:

```powershell
npx cdk deploy --parameters HostedZoneId=Z1234567890 --parameters DomainName=api.example.com
```

The default is intentionally one `t3.micro` instance and zero tasks during the first stack deployment; CodeBuild starts one task after pushing the image. Confirm current AWS free-tier eligibility for the selected region and account, and delete the stack when it is no longer needed. The ALB and public IPv4 addresses can incur charges outside applicable free-tier allowances.
