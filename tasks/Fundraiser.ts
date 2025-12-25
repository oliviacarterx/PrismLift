import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("task:campaign-address", "Prints the ZamaFundraiser address").setAction(async function (_args, hre) {
  const { deployments } = hre;
  const fundraiser = await deployments.get("ZamaFundraiser");
  console.log("ZamaFundraiser address is", fundraiser.address);
});

task("task:campaign-info", "Displays campaign details")
  .addOptionalParam("address", "Fundraiser address to inspect")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { deployments, ethers } = hre;
    const deployment = taskArguments.address ? { address: taskArguments.address } : await deployments.get("ZamaFundraiser");
    const fundraiser = await ethers.getContractAt("ZamaFundraiser", deployment.address);
    const [name, goal, endTime, closed, raised, organizer] = await fundraiser.getCampaignDetails();

    console.log("Name       :", name);
    console.log("Goal (ETH) :", ethers.formatEther(goal));
    console.log("End time   :", new Date(Number(endTime) * 1000).toISOString());
    console.log("Closed     :", closed);
    console.log("Raised (ETH):", ethers.formatEther(raised));
    console.log("Organizer  :", organizer);
  });

task("task:contribute", "Contribute ETH with encrypted amount")
  .addParam("value", "Contribution in ETH (e.g. 0.25)")
  .addOptionalParam("address", "Fundraiser address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { deployments, ethers, fhevm } = hre;

    await fhevm.initializeCLIApi();

    const deployment = taskArguments.address ? { address: taskArguments.address } : await deployments.get("ZamaFundraiser");
    const fundraiser = await ethers.getContractAt("ZamaFundraiser", deployment.address);
    const [signer] = await ethers.getSigners();

    const contributionWei = ethers.parseEther(taskArguments.value);
    const encryptedInput = await fhevm
      .createEncryptedInput(deployment.address, signer.address)
      .add64(contributionWei)
      .encrypt();

    console.log(`Sending ${ethers.formatEther(contributionWei)} ETH to ${deployment.address}`);
    const tx = await fundraiser
      .connect(signer)
      .contribute(encryptedInput.handles[0], encryptedInput.inputProof, { value: contributionWei });
    console.log("Waiting for tx:", tx.hash);
    await tx.wait();
    console.log("Contribution confirmed");
  });

task("task:decrypt-contribution", "Decrypt a contributor's encrypted balance")
  .addOptionalParam("address", "Fundraiser address")
  .addOptionalParam("user", "Contributor address (defaults to first signer)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { deployments, ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const deployment = taskArguments.address ? { address: taskArguments.address } : await deployments.get("ZamaFundraiser");
    const fundraiser = await ethers.getContractAt("ZamaFundraiser", deployment.address);

    const [defaultSigner] = await ethers.getSigners();
    const contributor = taskArguments.user ?? defaultSigner.address;

    const [encryptedAmount] = await fundraiser.getContribution(contributor);
    if (encryptedAmount === ethers.ZeroHash) {
      console.log("No encrypted contribution recorded for", contributor);
      return;
    }

    const clearValue = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedAmount,
      deployment.address,
      defaultSigner,
    );
    console.log(`Decrypted contribution for ${contributor}: ${clearValue.toString()} wei`);
  });

task("task:decrypt-total", "Decrypt the encrypted total (organizer should run this)")
  .addOptionalParam("address", "Fundraiser address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { deployments, ethers, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const deployment = taskArguments.address ? { address: taskArguments.address } : await deployments.get("ZamaFundraiser");
    const fundraiser = await ethers.getContractAt("ZamaFundraiser", deployment.address);
    const [signer] = await ethers.getSigners();

    const encryptedTotal = await fundraiser.getEncryptedTotalRaised();
    if (encryptedTotal === ethers.ZeroHash) {
      console.log("No encrypted total recorded yet");
      return;
    }

    const clearValue = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedTotal,
      deployment.address,
      signer,
    );
    console.log(`Decrypted total raised: ${clearValue.toString()} wei`);
  });

task("task:close-campaign", "Close the fundraiser and withdraw funds")
  .addOptionalParam("address", "Fundraiser address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { deployments, ethers } = hre;
    const deployment = taskArguments.address ? { address: taskArguments.address } : await deployments.get("ZamaFundraiser");
    const fundraiser = await ethers.getContractAt("ZamaFundraiser", deployment.address);
    const [signer] = await ethers.getSigners();

    const tx = await fundraiser.connect(signer).closeCampaign();
    console.log("Waiting for tx:", tx.hash);
    await tx.wait();
    console.log("Campaign closed and funds withdrawn");
  });
