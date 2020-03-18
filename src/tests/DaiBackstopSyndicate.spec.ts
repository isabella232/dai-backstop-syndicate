import * as ethers from 'ethers'
ethers.errors.setLogLevel("error")


import {
  AbstractContract,
  expect,
  RevertError,
  ZERO_ADDRESS
} from './utils'

import * as utils from './utils'
import { Dai } from 'typings/contracts/Dai'
import { DSToken } from 'typings/contracts/DSToken'
import { Vat } from 'typings/contracts/Vat'
import { Flopper } from 'typings/contracts/Flopper'
import { DaiJoin } from 'typings/contracts/DaiJoin'
import { MkrAuthority } from 'typings/contracts/MkrAuthority'
import { DaiBackstopSyndicate } from 'typings/contracts/DaiBackstopSyndicate'
import { BigNumber } from 'ethers/utils';
import { Zero } from 'ethers/constants'

// init test wallets from package.json mnemonic
const web3 = (global as any).web3

const {
  wallet: ownerWallet,
  provider: ownerProvider,
  signer: ownerSigner
} = utils.createTestWallet(web3, 0)

const {
  wallet: userWallet,
  provider: userProvider,
  signer: userSigner
} = utils.createTestWallet(web3, 2)

const {
  wallet: operatorWallet,
  provider: operatorProvider,
  signer: operatorSigner
} = utils.createTestWallet(web3, 4)

const {
  wallet: randomWallet,
  provider: randomProvider,
  signer: randomSigner
} = utils.createTestWallet(web3, 5)

const e18 = new BigNumber(10).pow(18)
const e27 = new BigNumber(10).pow(27)
const e45 = new BigNumber(10).pow(45)

contract('DaiBackstopSyndicate', (accounts: string[]) => {

  let ownerAddress: string
  let userAddress: string

  // Dai
  let daiAbstract: AbstractContract
  let daiOwnerContract: Dai
  let daiContract: Dai
  let daiAddress: string

  // MKR
  let mkrAbstract: AbstractContract
  let mkrOwnerContract: DSToken
  let mkrContract: DSToken
  let mkrAddress: string

  // Authority
  let authAbstract: AbstractContract
  let authOwnerContract: MkrAuthority
  let authContract: MkrAuthority
  let authAddress: string

  // VAT
  let vatAbstract: AbstractContract
  let vatOwnerContract: Vat
  let vatContract: Vat
  let vatAddress: string

  // VAT
  let daiJoinAbstract: AbstractContract
  let daiJoinOwnerContract: DaiJoin
  let daiJoinContract: DaiJoin
  let daiJoinAddress: string

  // Flopper
  let flopAbstract: AbstractContract
  let flopOwnerContract: Flopper
  let flopContract: Flopper
  let flopAddress: string

  // Syndicate
  let syndicateAbstract: AbstractContract
  let syndicateOwnerContract: DaiBackstopSyndicate
  let syndicateContract: DaiBackstopSyndicate
  let syndicateAddress: string

  // Auction parameters
  let AUCTION_START_TIME: number = 1584490000
  let tau: number = 2*24*60*60

  // kick
  let gal: string
  const lot: BigNumber = new BigNumber(550).mul(e18) // once above our target
  const bid: BigNumber = new BigNumber(50000).mul(e45)
  const bid_in_dai: BigNumber = bid.div(e27)

  // Enlist Parameters
  let user_dai_balance: BigNumber =  bid_in_dai.mul(5)
  let enlist_amount: BigNumber = new BigNumber(1000).mul(e18)

  // Ganache is often wrong with gas_estimation when doing cross-contract calls
  // so we use a high hard-coded gasLimit when needed
  let TX_PARAM = {gasLimit: 9000000}

  // load contract abi and deploy to test server
  before(async () => {
    ownerAddress = await ownerWallet.getAddress()
    gal = ownerAddress
    userAddress = await userWallet.getAddress()
    daiAbstract = await AbstractContract.fromArtifactName('Dai')
    mkrAbstract = await AbstractContract.fromArtifactName('DSToken')
    authAbstract = await AbstractContract.fromArtifactName('MkrAuthority')
    vatAbstract = await AbstractContract.fromArtifactName('Vat')
    daiJoinAbstract = await AbstractContract.fromArtifactName('DaiJoin')
    flopAbstract = await AbstractContract.fromArtifactName('Flopper')
    syndicateAbstract = await AbstractContract.fromArtifactName('DaiBackstopSyndicate')
  })

  // deploy before each test, to reset state of contract
  beforeEach(async () => {
    // Deploy DAI
    daiOwnerContract = await daiAbstract.deploy(ownerWallet, [1]) as Dai
    daiContract = await daiOwnerContract.connect(userSigner) as Dai
    daiAddress = daiOwnerContract.address

    // Deploy Authority
    authOwnerContract = await authAbstract.deploy(ownerWallet) as MkrAuthority
    authContract = await authOwnerContract.connect(userSigner) as MkrAuthority
    authAddress = authOwnerContract.address

    // Deploy MKR
    let sym = ethers.utils.formatBytes32String("MKR")
    mkrOwnerContract = await mkrAbstract.deploy(ownerWallet, [sym]) as DSToken
    mkrContract = await mkrOwnerContract.connect(userSigner) as DSToken
    mkrAddress = mkrOwnerContract.address

    // Deploy VAT
    vatOwnerContract = await vatAbstract.deploy(ownerWallet) as Vat
    vatContract = await vatOwnerContract.connect(userSigner) as Vat
    vatAddress = vatOwnerContract.address

    // Deploy Flopper
    flopOwnerContract = await flopAbstract.deploy(ownerWallet, [vatAddress, mkrAddress]) as Flopper
    flopContract = await flopOwnerContract.connect(userSigner) as Flopper
    flopAddress = flopOwnerContract.address

    // Deploy DaiJoin
    daiJoinOwnerContract = await daiJoinAbstract.deploy(ownerWallet, [
      vatAddress,
      daiAddress
    ]) as DaiJoin
    daiJoinContract = await daiJoinOwnerContract.connect(userSigner) as DaiJoin
    daiJoinAddress = daiJoinOwnerContract.address

    // Deploy Syndicate
    syndicateOwnerContract = await syndicateAbstract.deploy(ownerWallet, [
      daiAddress,
      mkrAddress,
      daiJoinAddress,
      vatAddress,
      flopAddress,
      {gasLimit: 9000000}
    ]) as DaiBackstopSyndicate
    syndicateContract = await syndicateOwnerContract.connect(userSigner) as DaiBackstopSyndicate
    syndicateAddress = syndicateOwnerContract.address
    // Set Authorities contract
    await mkrOwnerContract.functions.setAuthority(authAddress)
    await authOwnerContract.functions.rely(flopAddress)

    // Mint some DAI to users
    await daiOwnerContract.functions.mint(userAddress, user_dai_balance)

    // Mint some DAI to users
    await daiOwnerContract.functions.mint(ownerAddress, user_dai_balance)

    // Burden 0 address with sin to generate vatDai for daiJoin, to match the falsely created DAI
    await vatOwnerContract.suck(ZERO_ADDRESS, daiJoinAddress, user_dai_balance.mul(e27).mul(2))

    // Set user DAI approvals for transfers
    await daiContract.functions.approve(syndicateAddress, user_dai_balance)
    await daiOwnerContract.functions.approve(syndicateAddress, user_dai_balance)

    // Allow DAI-join to mint DAI
    await daiOwnerContract.functions.rely(daiJoinAddress)
  })

  describe('Getter functions', () => {
    describe('getStatus() function', () => {
      it('should return status', async () => {
        const status = await syndicateContract.functions.getStatus()
        expect(status).to.be.eql(0)
      })
    })
  })

  context('When auction have NOT started', () => {
    describe('enlist() function', () => {
      it('should PASS if user has enough DAI', async () => {
        const tx = syndicateContract.functions.enlist(enlist_amount, TX_PARAM)
        await expect(tx).to.be.fulfilled
      })

      it('should REVERT if user does not have enough dai', async () => {
        const tx = syndicateContract.functions.enlist(user_dai_balance.add(1))
        await expect(tx).to.be.rejectedWith(RevertError("Dai/insufficient-balance"))
      })

      context('When user enlisted', () => {
        beforeEach(async () => {
          await syndicateContract.functions.enlist(enlist_amount)
        })

        it('should mint syndicate shares', async () => {
          let balance = await syndicateContract.functions.balanceOf(userAddress)
          expect(balance).to.be.eql(enlist_amount)
        })

        it('should update combined DAI in syndicate', async () => {
          let balance = await syndicateContract.functions.getDaiBalance()
          expect(balance).to.be.eql(enlist_amount)
        })

        it('should update syndicate VAT syndicate DAI balance', async () => {
          let vat_balance = await vatContract.functions.dai(syndicateAddress)
          expect(vat_balance).to.be.eql(enlist_amount.mul(new BigNumber(10).pow(27)))
        })

        it('should update user DAI balance VAT', async () => {
          let balance = await daiContract.functions.balanceOf(userAddress)
          expect(balance).to.be.eql(user_dai_balance.sub(enlist_amount))
        })
      })
    })

    describe('defect() function', () => {
      it('should FAIL if user did not enlist', async () => {
        await syndicateOwnerContract.functions.enlist(1)
        const tx = syndicateContract.functions.defect(enlist_amount, TX_PARAM)
        await expect(tx).to.be.rejectedWith(RevertError("SafeMath: subtraction overflow"))
      })

      context('When user enlisted', () => {
        beforeEach(async () => {
          await syndicateContract.functions.enlist(enlist_amount)
        })

        it('should PASS if user withdraws all their DAI', async () => {
          const tx = syndicateContract.functions.defect(enlist_amount)
          await expect(tx).to.be.fulfilled
        })

        context('When user defected', () => {
          beforeEach(async () => {
            await syndicateContract.functions.defect(enlist_amount)
          })

          it('should burn syndicate shares', async () => {
            let balance = await syndicateContract.functions.balanceOf(userAddress)
            expect(balance).to.be.eql(Zero)
          })

          it('should update combined DAI in syndicate', async () => {
            let balance = await syndicateContract.functions.getDaiBalance()
            expect(balance).to.be.eql(Zero)
          })

          it('should update syndicate VAT syndicate DAI balance', async () => {
            let vat_balance = await vatContract.functions.dai(syndicateAddress)
            expect(vat_balance).to.be.eql(Zero)
          })

          it('should update user DAI balance', async () => {
            let balance = await daiContract.functions.balanceOf(userAddress)
            expect(balance).to.be.eql(user_dai_balance)
          })
        })
      })
    })
    describe('enterAuction() function', () => {
      it('should FAIL if user did not enlist', async () => {
        let tx = syndicateContract.functions.enterAuction(1)
        await expect(tx).to.be.rejectedWith(RevertError('Flopper/guy-not-set'))
      })
    })
  })

  context('When auctions HAVE started', () => {
    beforeEach(async () => {
      await flopOwnerContract.functions.kick(gal, lot, bid)
    })

    describe('enlist() function', () => {
      it('should PASS if user has enough DAI', async () => {
        const tx = syndicateContract.functions.enlist(enlist_amount, TX_PARAM)
        await expect(tx).to.be.fulfilled
      })

      it('should REVERT if user does not have enough dai', async () => {
        const tx = syndicateContract.functions.enlist(user_dai_balance.add(1))
        await expect(tx).to.be.rejectedWith(RevertError("Dai/insufficient-balance"))
      })

      context('When user enlisted', () => {
        beforeEach(async () => {
          await syndicateContract.functions.enlist(enlist_amount)
        })

        it('should mint syndicate shares', async () => {
          let balance = await syndicateContract.functions.balanceOf(userAddress)
          expect(balance).to.be.eql(enlist_amount)
        })

        it('should update combined DAI in syndicate', async () => {
          let balance = await syndicateContract.functions.getDaiBalance()
          expect(balance).to.be.eql(enlist_amount)
        })

        it('should update syndicate VAT syndicate DAI balance', async () => {
          let vat_balance = await vatContract.functions.dai(syndicateAddress)
          expect(vat_balance).to.be.eql(enlist_amount.mul(new BigNumber(10).pow(27)))
        })

        it('should update user DAI balance VAT', async () => {
          let balance = await daiContract.functions.balanceOf(userAddress)
          expect(balance).to.be.eql(user_dai_balance.sub(enlist_amount))
        })
      })
    })

    describe('defect() function', () => {
      it('should FAIL if user did not enlist', async () => {
        await syndicateOwnerContract.functions.enlist(1)
        const tx = syndicateContract.functions.defect(enlist_amount, TX_PARAM)
        await expect(tx).to.be.rejectedWith(RevertError("SafeMath: subtraction overflow"))
      })

      context('When user enlisted', () => {
        beforeEach(async () => {
          await syndicateContract.functions.enlist(enlist_amount)
        })

        it('should PASS if user withdraws all their DAI', async () => {
          const tx = syndicateContract.functions.defect(enlist_amount)
          await expect(tx).to.be.fulfilled
        })

        context('When user defected', () => {
          beforeEach(async () => {
            await syndicateContract.functions.defect(enlist_amount)
          })

          it('should burn syndicate shares', async () => {
            let balance = await syndicateContract.functions.balanceOf(userAddress)
            expect(balance).to.be.eql(Zero)
          })

          it('should update combined DAI in syndicate', async () => {
            let balance = await syndicateContract.functions.getDaiBalance()
            expect(balance).to.be.eql(Zero)
          })

          it('should update syndicate VAT syndicate DAI balance', async () => {
            let vat_balance = await vatContract.functions.dai(syndicateAddress)
            expect(vat_balance).to.be.eql(Zero)
          })

          it('should update user DAI balance', async () => {
            let balance = await daiContract.functions.balanceOf(userAddress)
            expect(balance).to.be.eql(user_dai_balance)
          })
        })
      })
    })

    describe('enterAuction() function', () => {
      it('should FAIL if not enough DAI', async () => {
        await syndicateContract.functions.enlist(bid_in_dai.sub(1))
        const tx = syndicateContract.functions.enterAuction(1)
        await expect(tx).to.be.rejected; //No revert message on vat underflow :/
      })
      context('When enough DAI is in the syndicate', () => {
        beforeEach(async () => {
          // Adding a bit more for some tests + make sure surplus work
          await syndicateContract.functions.enlist(bid_in_dai)
        })
        it('should PASS if enough DAI in syndicate', async () => {
          const tx = syndicateContract.functions.enterAuction(1)
          await expect(tx).to.be.fulfilled;
        })
        context('When entered an auction', () => {
          beforeEach(async () => {
            await syndicateContract.functions.enterAuction(1)
          })

          it('auction should be considered active', async () => {
            let auctions = await syndicateContract.functions.getActiveAuctions()
            await expect(auctions.length).to.be.eql(1);
            await expect(auctions[0]).to.be.eql(new BigNumber(1))
          })

          it('syndicate status should be set to ACTIVATED', async () => {
            let status = await syndicateContract.functions.getStatus()
            await expect(status).to.be.eql(1);
          })
          
          it('should set bid to be correct', async () => {
            let bid_obj = await syndicateContract.functions.getCurrentBid(1)
            await expect(bid_obj[0]).to.be.eql(bid);
          })

          it('should set MKR in bid to 500 (price 100:1)', async () => {
            let bid_obj = await syndicateContract.functions.getCurrentBid(1)
            await expect(bid_obj[1]).to.be.eql(new BigNumber(500).mul(e18));
          })

          it('should set current bidder to syndicate', async () => {
            let bid_obj = await syndicateContract.functions.getCurrentBid(1)
            await expect(bid_obj[2]).to.be.eql(syndicateAddress);
          })

          // it.only('should PREVENT new deposits', async () => {
          //   let tx = syndicateContract.functions.enlist(1)
          //   await expect(tx).to.be.rejectedWith(RevertError('DaiBackstopSyndicate/enlist: Cannot deposit once the first auction bid has been made.'))
          // })

          // it.only('should PREVENT defects if not enough DAI in syndicate', async () => {
          //   console.log(await vatContract.functions.dai(syndicateAddress))
          //   console.log(enlist_amount)
          //   let tx = syndicateContract.functions.defect(enlist_amount.add(1))
          //   await expect(tx).to.be.rejectedWith(RevertError("DaiBackstopSyndicate/defect: Insufficient Dai (in use in auctions)"))
          // })

          // it.only('should ALLOW defects if enough DAI in syndicate', async () => {
          //   let tx = syndicateContract.functions.defect(enlist_amount)
          //   await expect(tx).to.be.fulfilled
          // })
        })
      })
    })
  })
})
