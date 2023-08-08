import {
  AmplicationPlugin,
  CreateMessageBrokerClientOptionsFactoryParams,
  CreateMessageBrokerNestJSModuleParams,
  CreateMessageBrokerParams,
  CreateMessageBrokerServiceParams,
  CreateServerAppModuleParams,
  CreateServerDockerComposeDevParams,
  CreateServerDotEnvParams,
  CreateServerPackageJsonParams,
  DsgContext,
  EnumMessagePatternConnectionOptions,
  Events,
  Module,
  ModuleMap,
} from "@amplication/code-gen-types";
import { readFile, print } from "@amplication/code-gen-utils";
import { kebabCase, merge } from "lodash";
import { join, resolve } from "path";
import { staticDirectory, templatesPath } from "./constants";
import { builders } from "ast-types";
import { getClassDeclarationById, interpolate } from "./util/ast";
class KafkaPlugin implements AmplicationPlugin {
  static moduleFile: Module | undefined;
  init?: ((name: string, version: string) => void) | undefined;
  register(): Events {
    return {
      CreateServerDotEnv: {
        before: this.beforeCreateServerDotEnv,
      },
      CreateServerPackageJson: {
        before: this.beforeCreateServerPackageJson,
      },
      CreateServerDockerComposeDev: {
        before: this.beforeCreateDockerComposeDev,
      },
      CreateMessageBroker: {
        before: this.beforeCreateBroker,
      },
      CreateServerAppModule: {
        before: this.beforeCreateServerAppModule,
      },
      CreateMessageBrokerClientOptionsFactory: {
        after: this.afterCreateMessageBrokerClientOptionsFactory,
      },
      CreateMessageBrokerNestJSModule: {
        after: this.afterCreateMessageBrokerNestJSModule,
      },
      CreateMessageBrokerService: {
        after: this.afterCreateMessageBrokerService,
      },
      CreateMessageBrokerTopicsEnum: {
        before: this.beforeCreateMessageBroker,
      },
    };
  }

  async afterCreateMessageBrokerClientOptionsFactory(
    context: DsgContext,
    eventParams: CreateMessageBrokerClientOptionsFactoryParams
  ): Promise<ModuleMap> {
    const { serverDirectories } = context;
    const filePath = resolve(staticDirectory, "generateKafkaClientOptions.ts");
    const file = await readFile(filePath);
    const generateFileName = "generateKafkaClientOptions.ts";

    const path = join(
      serverDirectories.messageBrokerDirectory,
      generateFileName
    );
    const modules = new ModuleMap(context.logger);
    await modules.set({ code: print(file).code, path });
    return modules;
  }

  async beforeCreateMessageBroker(
    context: DsgContext,
    eventParams: CreateMessageBrokerParams
  ) {
    const templatePath = join(templatesPath, "controller.template.ts");
    const template = await readFile(templatePath);
    const controllerId = builders.identifier(`KafkaController`);
    const templateMapping = {
      CONTROLLER: controllerId,
    };

    interpolate(template, templateMapping);
    const classDeclaration = getClassDeclarationById(template, controllerId);

    const serviceReceivedTopics = context.serviceTopics?.map((serviceTopic) => {
      serviceTopic.patterns.forEach((topic) => {
        if (!topic.topicName) {
          throw new Error(`Topic name not found for topic id ${topic.topicId}`);
        }

        if (topic.type !== EnumMessagePatternConnectionOptions.Receive) return;

        const eventPatternDecorator = builders.decorator(
          builders.callExpression(builders.identifier("EventPattern"), [
            builders.stringLiteral(topic.topicName),
          ])
        );

        const payloadDecorator = builders.decorator(
          builders.callExpression(builders.identifier("Payload"), [])
        );

        const messageIdentifier = builders.identifier.from({
          name: "message",
          typeAnnotation: builders.tsTypeAnnotation(
            builders.tsTypeReference(builders.identifier("Any"))
          ),
          //@ts-ignore
          decorators: [payloadDecorator],
        });

        const currentClassMethod = builders.classMethod(
          "method",
          builders.identifier(`on${topic.topicName}`),

          [messageIdentifier],
          builders.blockStatement([])
        );

        currentClassMethod.async = true;
        currentClassMethod.returnType = builders.tsTypeAnnotation(
          builders.tsTypeReference(
            builders.identifier("Promise"),
            builders.tsTypeParameterInstantiation([builders.tsVoidKeyword()])
          )
        );

        if (!currentClassMethod.decorators) {
          currentClassMethod.decorators = [];
        }
        currentClassMethod.decorators.push(eventPatternDecorator);

        classDeclaration.body.body.push(currentClassMethod);
      });
    });
    const filePath = join(
      context.serverDirectories.messageBrokerDirectory,
      "kafka.controller.ts"
    );

    await context.logger.info(`controller file: ${print(template).code}`);
    const controllerFile = { code: print(template).code, path: filePath };
    await context.modules.set(controllerFile);

    return eventParams;
  }

  beforeCreateBroker(
    dsgContext: DsgContext,
    eventParams: CreateMessageBrokerParams
  ): CreateMessageBrokerParams {
    dsgContext.serverDirectories.messageBrokerDirectory = join(
      dsgContext.serverDirectories.srcDirectory,
      "kafka"
    );
    return eventParams;
  }

  async afterCreateMessageBrokerNestJSModule(
    context: DsgContext,
    eventParams: CreateMessageBrokerNestJSModuleParams
  ): Promise<ModuleMap> {
    const filePath = resolve(staticDirectory, "kafka.module.ts");

    const { serverDirectories } = context;
    const { messageBrokerDirectory } = serverDirectories;
    const file = await readFile(filePath);
    const generateFileName = "kafka.module.ts";

    KafkaPlugin.moduleFile = {
      code: print(file).code,
      path: join(messageBrokerDirectory, generateFileName),
    };

    const modules = new ModuleMap(context.logger);
    await modules.set(KafkaPlugin.moduleFile);
    return modules;
  }

  beforeCreateServerDotEnv(
    context: DsgContext,
    eventParams: CreateServerDotEnvParams
  ): CreateServerDotEnvParams {
    const resourceName = context.resourceInfo?.name;

    const vars = {
      KAFKA_BROKERS: "localhost:9092",
      KAFKA_ENABLE_SSL: "false",
      KAFKA_CLIENT_ID: kebabCase(resourceName),
      KAFKA_GROUP_ID: kebabCase(resourceName),
    };
    const newEnvParams = [
      ...eventParams.envVariables,
      ...Object.entries(vars).map(([key, value]) => ({ [key]: value })),
    ];
    return { envVariables: newEnvParams };
  }

  beforeCreateServerPackageJson(
    context: DsgContext,
    eventParams: CreateServerPackageJsonParams
  ): CreateServerPackageJsonParams {
    const myValues = {
      dependencies: {
        "@nestjs/microservices": "8.2.3",
        kafkajs: "2.2.0",
      },
    };

    eventParams.updateProperties.forEach((updateProperty) =>
      merge(updateProperty, myValues)
    );

    return eventParams;
  }

  async afterCreateMessageBrokerService(
    context: DsgContext,
    eventParams: CreateMessageBrokerServiceParams
  ): Promise<ModuleMap> {
    const { serverDirectories } = context;
    const { messageBrokerDirectory } = serverDirectories;
    const filePath = resolve(staticDirectory, `kafka.service.ts`);

    const file = await readFile(filePath);
    const generateFileName = `kafka.service.ts`;

    const path = join(messageBrokerDirectory, generateFileName);
    const modules = new ModuleMap(context.logger);
    await modules.set({ code: print(file).code, path });
    return modules;
  }

  beforeCreateDockerComposeDev(
    dsgContext: DsgContext,
    eventParams: CreateServerDockerComposeDevParams
  ): CreateServerDockerComposeDevParams {
    const KAFKA_NAME = "kafka";
    const ZOOKEEPER_NAME = "zookeeper";
    const KAFKA_UI = "kafka-ui";
    const NETWORK = "internal";
    const ZOOKEEPER_PORT = "2181";
    const KAFKA_PORT = "9092";
    const newParams = {
      services: {
        [ZOOKEEPER_NAME]: {
          image: "confluentinc/cp-zookeeper:5.2.4",
          networks: [NETWORK],
          environment: {
            ZOOKEEPER_CLIENT_PORT: 2181,
            ZOOKEEPER_TICK_TIME: 2000,
          },
          ports: [`${ZOOKEEPER_PORT}:${ZOOKEEPER_PORT}`],
        },
        [KAFKA_NAME]: {
          image: "confluentinc/cp-kafka:7.3.1",
          networks: [NETWORK],
          depends_on: [ZOOKEEPER_NAME],
          ports: ["9092:9092", "9997:9997"],
          environment: {
            KAFKA_BROKER_ID: 1,
            KAFKA_ZOOKEEPER_CONNECT: `${ZOOKEEPER_NAME}:${ZOOKEEPER_PORT}`,
            KAFKA_ADVERTISED_LISTENERS: `PLAINTEXT://${KAFKA_NAME}:29092,PLAINTEXT_HOST://localhost:${KAFKA_PORT}`,
            KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: `PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT`,
            KAFKA_INTER_BROKER_LISTENER_NAME: `PLAINTEXT`,
            KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1,
            KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1,
            KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1,
          },
        },
        [KAFKA_UI]: {
          container_name: KAFKA_UI,
          image: "provectuslabs/kafka-ui:latest",
          ports: ["8080:8080"],
          depends_on: [ZOOKEEPER_NAME, KAFKA_NAME],
          environment: {
            KAFKA_CLUSTERS_0_NAME: "local",
            KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: "kafka:29092",
            KAFKA_CLUSTERS_0_ZOOKEEPER: "zookeeper:2181",
            KAFKA_CLUSTERS_0_JMXPORT: 9997,
          },
        },
        networks: {
          internal: {
            name: NETWORK,
            driver: "bridge",
          },
        },
      },
    };
    eventParams.updateProperties.push(newParams);
    return eventParams;
  }

  beforeCreateServerAppModule(
    dsgContext: DsgContext,
    eventParams: CreateServerAppModuleParams
  ) {
    const file = KafkaPlugin.moduleFile;
    if (!file) {
      throw new Error("Kafka module file not found");
    }
    const kafkaModuleId = builders.identifier("KafkaModule");

    const importArray = builders.arrayExpression([
      kafkaModuleId,
      ...eventParams.templateMapping["MODULES"].elements,
    ]);

    eventParams.templateMapping["MODULES"] = importArray;

    eventParams.modulesFiles.set(file);
    return eventParams;
  }
}

export default KafkaPlugin;
