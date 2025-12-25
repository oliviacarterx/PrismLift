import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import * as dotenv from "dotenv";

dotenv.config();

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const campaignName = process.env.CAMPAIGN_NAME ?? "PrismLift Launch";
  const goalEth = process.env.CAMPAIGN_GOAL_ETH ?? "10";
  const durationDays = parseInt(process.env.CAMPAIGN_DURATION_DAYS ?? "14", 10);

  if (Number.isNaN(durationDays) || durationDays <= 0) {
    throw new Error("CAMPAIGN_DURATION_DAYS must be a positive integer");
  }

  const fundraisingGoal = hre.ethers.parseEther(goalEth);
  const endTime = Math.floor(Date.now() / 1000) + durationDays * 24 * 60 * 60;

  const deployedFundraiser = await deploy("ZamaFundraiser", {
    from: deployer,
    args: [campaignName, fundraisingGoal, endTime],
    log: true,
  });

  console.log(`ZamaFundraiser campaign: ${campaignName}`);
  console.log(`Goal (wei): ${fundraisingGoal.toString()}`);
  console.log(`Ends at: ${endTime}`);
  console.log(`ZamaFundraiser contract: ${deployedFundraiser.address}`);
};
export default func;
func.id = "deploy_zamaFundraiser"; // id required to prevent reexecution
func.tags = ["ZamaFundraiser"];
