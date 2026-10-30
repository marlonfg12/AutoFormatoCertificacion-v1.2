export interface ScenarioEvidence {
  scenarioId: string;
  scenarioTitle: string;
  outcome: 'Exitosa' | 'Fallida' | 'Activa' | string;
  observations: string;
  evidenceImages: string[];
}

export interface UserStoryContext {
  id: string;
  name: string;
  fullName: string;
  scenarios: ScenarioEvidence[];
  totalScenarios: number;
  passedScenarios: number;
}

export interface DocumentMetadata {
  projectName: string;
  projectId: string;
  sprint: string;
  requester: string;
  module: string;
  testStage: string;
  testingArea: string;
  startDate: string;
  endDate: string;
  environment: string;
  testType: string;
  urlOrVersion: string;
  observations: string;
}

