const fetch = require('node-fetch');
const core = require('@actions/core');

const { Headers, Request } = fetch;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const getPipelineWorkflows = async (pipelineId, circleCiToken, pageToken) => {
  const headers = new Headers({
    'Circle-Token': circleCiToken
  });

  const request = new Request(
    `https://circleci.com/api/v2/pipeline/${pipelineId}/workflow${pageToken && `?page-token=${pageToken}`}`,
    {
      method: 'GET',
      headers: headers,
    }
  );

  const response = await fetch(request);
  const json = await response.json();

  let items = json.items;
  let next_page_token = json.next_page_token;

  if (next_page_token) {
    return [...items, ...(await getPipelineWorkflows(pipelineId, circleCiToken, next_page_token))];
  }

  return items;
}

(async () => {
  try {
    const inputCciToken = core.getInput('token', { required: true });
    const inputPipelineId = core.getInput('pipeline', { required: true });
    const inputInterval = core.getInput('interval');
    const inputTimeout = core.getInput('timeout');

    const pollRate = Number.parseInt(inputInterval || 10) * 1000;
    const timeout = Number.parseInt(inputTimeout || 15) * 60000;

    const maxRunTime = new Date(new Date().getTime() + timeout).getTime();

    const failingStatuses = ['cancelled', 'error', 'failed', 'failing', 'unauthorized'];
    const successfulStatuses = ['on_hold', 'success'];

    while(true && !(new Date().getTime() > maxRunTime)) {
      const workflows = await getPipelineWorkflows(inputPipelineId, inputCciToken).map(workflow => {
        const { name, status } = workflow;

        return { name, status };
      });

      console.log(`Workflows present on CircleCI Pipeline ID (${inputPipelineId}):`);
      console.table(workflows);
      console.log('\n');

      const failedWorkflow = workflows.find((workflow) => {
        failingStatuses.includes(workflow.status);
      });

      if (failedWorkflow) {
        core.setFailed(`Failed on workflow: ${failedWorkflow.name}`);
        return;
      }

      const successfulWorkflows = workflows.filter(workflow => {
        successfulStatuses.includes(workflow.status);
      });

      if (successfulWorkflows.length === workflows.length) {
        console.log(`All workflows passed for pipeline ${pipelineId}!`);
        
        return;
      }
      
      console.log(`Waiting ${pollRate}s`);
      await delay(pollRate);
    }

    return;
  } catch(err) {
    core.setFailed(`Error: ${err.message}`)
  }
})();
