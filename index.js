const fetch = require('node-fetch');
const core = require('@actions/core');
const github = require('@actions/github');
const { Octokit } = require('octokit');

const isVerbose = core.getInput('verbose').toLowerCase() === 'true';

const { Headers, Request } = fetch;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const getPipelineWorkflows = async (pipelineId, circleCiToken, pageToken) => {
  const headers = new Headers({
    'Circle-Token': circleCiToken
  });

  const requestUrl = `https://circleci.com/api/v2/pipeline/${pipelineId}/workflow${pageToken ? `?page-token=${pageToken}` : ''}`;

  isVerbose && console.log(`Request URL: ${requestUrl}`);

  const request = new Request(
    requestUrl,
    {
      method: 'GET',
      headers: headers,
    }
  );

  const response = await fetch(request);

  isVerbose && console.log(response);

  const json = await response.json();

  isVerbose && console.log(json);

  let items = json.items;
  let next_page_token = json.next_page_token;

  isVerbose && console.log(`next_page_token: ${next_page_token}`);

  if (next_page_token) {
    return [...items, ...(await getPipelineWorkflows(pipelineId, circleCiToken, next_page_token))];
  }

  return items;
}

const createCheck = async (octokit, head_sha, repo) => {
  isVerbose && console.log('Creating Check');

  const { data: { id } } = await octokit.rest.checks.create({
    ...repo,
    head_sha,
    name: 'CircleCI Pipeline Polling',
    status: 'in_progress',
  });

  isVerbose && console.log(`Check ID: ${id}`);

  return id;
}

const updateCheck = async (octokit, check_run_id, repo, conclusion) => {
  isVerbose && console.log('Updating Check');

  await octokit.rest.checks.update({
    ...repo,
    check_run_id,
    conclusion,
  });

  isVerbose && console.log(`Updated Check`);
}

(async () => {
  try {
    const inputCciToken = core.getInput('cci-token', { required: true });
    const inputGhToken = core.getInput('gh-token', { required: true });
    const inputInterval = core.getInput('interval');
    const inputPipelineId = core.getInput('pipeline', { required: true });
    const inputSha = core.getInput('sha', { required: true });
    const inputTimeout = core.getInput('timeout');

    const octokit = new Octokit({ auth: inputGhToken });
    
    const repo = {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
    };

    const checkId = await createCheck(octokit, inputSha, repo);

    if (isVerbose) {
      console.log(`Has CCI Token: ${inputCciToken ? '✓' : 'x'}`);
      console.log(`Has GH Token: ${inputGhToken ? '✓' : 'x'}`);
      console.log(`Pipeline ID: ${inputPipelineId}`);
      console.log(`Interval: ${inputInterval}`);
      console.log(`Commit SHA: ${inputSha}`);
      console.log(`Timeout: ${inputTimeout}`);
    }

    const pollRate = Number.parseInt(inputInterval || 10) * 1000;
    const timeout = Number.parseInt(inputTimeout || 15) * 60000;

    const maxRunTime = new Date(new Date().getTime() + timeout).getTime();

    const failingStatuses = ['cancelled', 'error', 'failed', 'failing', 'unauthorized'];
    const successfulStatuses = ['on_hold', 'success'];

    let runTime = 0;

    while(true && !(new Date().getTime() > maxRunTime)) {
      const items = await getPipelineWorkflows(inputPipelineId, inputCciToken);

      isVerbose && console.log(items);

      const workflows = items.map(workflow => {
        const { name, status } = workflow;

        return { name, status };
      });

      console.log(`Workflows present on CircleCI Pipeline ID (${inputPipelineId}):`);
      console.table(workflows);

      const failedWorkflow = workflows.find((workflow) => {
        return failingStatuses.includes(workflow.status);
      });

      if (failedWorkflow) {
        core.setFailed(`Failed on workflow: ${failedWorkflow.name}`);
        await updateCheck(octokit, checkId, repo, "failure");

        return;
      }

      const successfulWorkflows = workflows.filter(workflow => {
        return successfulStatuses.includes(workflow.status);
      });

      if (successfulWorkflows.length === workflows.length) {
        console.log(`All workflows passed for pipeline ${pipelineId}!`);
        await updateCheck(octokit, checkId, repo, "success");
        
        return;
      }

      console.log(`Runtime: ${runTime / 1000}s (${pollRate / 1000}s)`);

      runTime += pollRate;
      await delay(pollRate);
    }

    await updateCheck(octokit, checkId, repo, "timed_out");

    return;
  } catch(err) {
    core.setFailed(`Error: ${err.message}`)
  }
})();
