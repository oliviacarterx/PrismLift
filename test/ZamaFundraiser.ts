import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { ZamaFundraiser, ZamaFundraiser__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const name = "PrismLift";
  const goal = ethers.parseEther("5");
  const latestBlock = await ethers.provider.getBlock("latest");
  const baseTime = Number(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));
  const endTime = baseTime + 24 * 60 * 60;
  const factory = (await ethers.getContractFactory("ZamaFundraiser")) as ZamaFundraiser__factory;
  const fundraiser = (await factory.deploy(name, goal, endTime)) as ZamaFundraiser;
  const fundraiserAddress = await fundraiser.getAddress();

  return { fundraiser, fundraiserAddress, goal, endTime, name };
}

describe("ZamaFundraiser", function () {
  let signers: Signers;
  let fundraiser: ZamaFundraiser;
  let fundraiserAddress: string;
  let goal: bigint;
  let endTime: number;
  let name: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ fundraiser, fundraiserAddress, goal, endTime, name } = await deployFixture());
  });

  it("initializes campaign details", async function () {
    const [storedName, storedGoal, storedEndTime, closed, raised, organizer] = await fundraiser.getCampaignDetails();
    expect(storedName).to.eq(name);
    expect(storedGoal).to.eq(goal);
    expect(storedEndTime).to.eq(endTime);
    expect(closed).to.eq(false);
    expect(raised).to.eq(0n);
    expect(organizer).to.eq(signers.deployer.address);
  });

  it("records encrypted contributions per user and total", async function () {
    const contributionWei = ethers.parseEther("1");
    const encryptedInput = await fhevm
      .createEncryptedInput(fundraiserAddress, signers.alice.address)
      .add64(contributionWei)
      .encrypt();

    const tx = await fundraiser
      .connect(signers.alice)
      .contribute(encryptedInput.handles[0], encryptedInput.inputProof, { value: contributionWei });
    await tx.wait();

    const [encryptedAmount, clearAmount, lastAt] = await fundraiser.getContribution(signers.alice.address);
    expect(clearAmount).to.eq(contributionWei);
    expect(lastAt).to.be.gt(0);

    const decryptedContribution = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedAmount,
      fundraiserAddress,
      signers.alice,
    );
    expect(decryptedContribution).to.eq(contributionWei);

    const encryptedTotal = await fundraiser.getEncryptedTotalRaised();
    const decryptedTotal = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedTotal,
      fundraiserAddress,
      signers.deployer,
    );
    expect(decryptedTotal).to.eq(contributionWei);

    const [, , endTimeAfter, closed, raised] = await fundraiser.getCampaignDetails();
    expect(endTimeAfter).to.eq(endTime);
    expect(closed).to.eq(false);
    expect(raised).to.eq(contributionWei);
  });

  it("sums multiple encrypted contributions", async function () {
    const first = ethers.parseEther("0.4");
    const second = ethers.parseEther("0.6");

    const encryptedFirst = await fhevm
      .createEncryptedInput(fundraiserAddress, signers.bob.address)
      .add64(first)
      .encrypt();
    await fundraiser
      .connect(signers.bob)
      .contribute(encryptedFirst.handles[0], encryptedFirst.inputProof, { value: first });

    const encryptedSecond = await fhevm
      .createEncryptedInput(fundraiserAddress, signers.bob.address)
      .add64(second)
      .encrypt();
    await fundraiser
      .connect(signers.bob)
      .contribute(encryptedSecond.handles[0], encryptedSecond.inputProof, { value: second });

    const [encryptedAmount, clearAmount] = await fundraiser.getContribution(signers.bob.address);
    const decrypted = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedAmount,
      fundraiserAddress,
      signers.bob,
    );

    expect(decrypted).to.eq(first + second);
    expect(clearAmount).to.eq(first + second);
  });

  it("blocks contributions after deadline or when closed", async function () {
    const contributionWei = ethers.parseEther("0.1");

    await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
    await ethers.provider.send("evm_mine", []);

    const encryptedInput = await fhevm
      .createEncryptedInput(fundraiserAddress, signers.alice.address)
      .add64(contributionWei)
      .encrypt();

    await expect(
      fundraiser
        .connect(signers.alice)
        .contribute(encryptedInput.handles[0], encryptedInput.inputProof, { value: contributionWei }),
    ).to.be.revertedWith("Campaign ended");

    ({ fundraiser, fundraiserAddress, goal, endTime, name } = await deployFixture());

    const encryptedInput2 = await fhevm
      .createEncryptedInput(fundraiserAddress, signers.alice.address)
      .add64(contributionWei)
      .encrypt();

    await fundraiser
      .connect(signers.alice)
      .contribute(encryptedInput2.handles[0], encryptedInput2.inputProof, { value: contributionWei });

    await fundraiser.connect(signers.deployer).closeCampaign();

    const encryptedInput3 = await fhevm
      .createEncryptedInput(fundraiserAddress, signers.alice.address)
      .add64(contributionWei)
      .encrypt();

    await expect(
      fundraiser
        .connect(signers.alice)
        .contribute(encryptedInput3.handles[0], encryptedInput3.inputProof, { value: contributionWei }),
    ).to.be.revertedWith("Campaign closed");
  });

  it("lets the organizer withdraw funds when closing", async function () {
    const contributionWei = ethers.parseEther("0.5");
    const encryptedInput = await fhevm
      .createEncryptedInput(fundraiserAddress, signers.alice.address)
      .add64(contributionWei)
      .encrypt();

    await fundraiser
      .connect(signers.alice)
      .contribute(encryptedInput.handles[0], encryptedInput.inputProof, { value: contributionWei });

    const organizerBalanceBefore = await ethers.provider.getBalance(signers.deployer.address);
    const closeTx = await fundraiser.connect(signers.deployer).closeCampaign();
    const receipt = await closeTx.wait();
    const gasUsed = receipt!.gasUsed;
    const gasPrice = receipt!.effectiveGasPrice ?? 0n;
    const gasCost = BigInt(gasUsed) * BigInt(gasPrice);
    const organizerBalanceAfter = await ethers.provider.getBalance(signers.deployer.address);

    const contractBalanceAfter = await ethers.provider.getBalance(fundraiserAddress);
    const [, , , closed] = await fundraiser.getCampaignDetails();

    expect(closed).to.eq(true);
    expect(contractBalanceAfter).to.eq(0n);
    expect(organizerBalanceAfter).to.be.gt(organizerBalanceBefore);
  });
});
