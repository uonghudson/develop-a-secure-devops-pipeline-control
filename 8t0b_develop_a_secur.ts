import * as fs from 'fs';
import * as path from 'path';
import * as yargs from 'yargs';
import * as tls from 'tls';
import * as crypto from 'crypto';
import * as express from 'express';

interface IConfig {
  pipelineName: string;
  gitRepoUrl: string;
  deploymentEnvironment: string;
  tlsCertificate: string;
  tlsKey: string;
}

interface IPipelineStep {
  name: string;
  command: string;
  environmentVariables: { [key: string]: string };
}

class SecureDevOpsPipelineController {
  private config: IConfig;
  private pipelineSteps: IPipelineStep[];
  private tlsOptions: tls.TlsOptions;

  constructor(config: IConfig) {
    this.config = config;
    this.pipelineSteps = [];
    this.tlsOptions = {
      key: fs.readFileSync(path.join(__dirname, config.tlsKey)),
      cert: fs.readFileSync(path.join(__dirname, config.tlsCertificate)),
    };
  }

  addPipelineStep(step: IPipelineStep) {
    this.pipelineSteps.push(step);
  }

  async runPipeline(): Promise<void> {
    const app = express();
    app.use(express.json());

    app.post('/pipeline', (req, res) => {
      if (!req.body.trigger) {
        res.status(401).send('Unauthorized');
        return;
      }

      const triggerToken = crypto.createHmac('sha256', this.config.pipelineName).update(req.body.trigger).digest('hex');
      if (triggerToken !== process.env.TRIGGER_TOKEN) {
        res.status(401).send('Unauthorized');
        return;
      }

      this.executePipelineSteps().then(() => {
        res.send('Pipeline executed successfully');
      }).catch((err) => {
        res.status(500).send(`Error executing pipeline: ${err}`);
      });
    });

    const server = tls.createServer(this.tlsOptions, app);
    server.listen(3000, () => {
      console.log(`Secure DevOps pipeline controller listening on port 3000`);
    });
  }

  private async executePipelineSteps(): Promise<void> {
    for (const step of this.pipelineSteps) {
      console.log(`Executing step: ${step.name}`);
      await this.executeCommand(step.command, step.environmentVariables);
    }
  }

  private async executeCommand(command: string, environmentVariables: { [key: string]: string }): Promise<void> {
    const childProcess = childProcess.exec(command, { env: environmentVariables });
    childProcess.stdout.on('data', (data) => {
      console.log(` stdout: ${data}`);
    });

    childProcess.stderr.on('data', (data) => {
      console.error(` stderr: ${data}`);
    });

    await new Promise((resolve, reject) => {
      childProcess.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with code ${code}`));
        }
      });
    });
  }
}

const argv = yargs.argv;
const config: IConfig = {
  pipelineName: argv.pipelineName,
  gitRepoUrl: argv.gitRepoUrl,
  deploymentEnvironment: argv.deploymentEnvironment,
  tlsCertificate: argv.tlsCertificate,
  tlsKey: argv.tlsKey,
};

const controller = new SecureDevOpsPipelineController(config);

controller.addPipelineStep({
  name: 'Build',
  command: 'npm run build',
  environmentVariables: { NODE_ENV: 'production' },
});

controller.addPipelineStep({
  name: 'Deploy',
  command: `docker deploy -p ${config.deploymentEnvironment}`,
  environmentVariables: { DEPLOYMENT_ENVIRONMENT: config.deploymentEnvironment },
});

controller.runPipeline();