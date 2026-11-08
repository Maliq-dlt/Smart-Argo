import test from 'node:test'
import assert from 'node:assert/strict'
import {parseRewardWorkspace} from '../src/lib/productRewardClient.ts'
const base={ok:true,roles:['owner'],policy:null,balance:{confirmed_points:10,reserved_points:4,available_points:6},catalog:[],redemptions:[],ledger:[],fulfillment_queue:[]}
test('reward response boundary rejects failed, inconsistent or malformed financial state',()=>{
 assert.equal(parseRewardWorkspace(base).balance.available_points,6)
 assert.throws(()=>parseRewardWorkspace({...base,ok:false}))
 assert.throws(()=>parseRewardWorkspace({...base,balance:{...base.balance,available_points:10}}))
 const item={id:'123e4567-e89b-42d3-a456-426614174000',title:'Synthetic catalogue',point_cost:4,stock_total:1,stock_reserved:0,availability:'available'}
 assert.equal(parseRewardWorkspace({...base,catalog:[item]}).catalog.length,1)
 assert.throws(()=>parseRewardWorkspace({...base,catalog:[{...item,id:'not-a-uuid'}]}))
 assert.throws(()=>parseRewardWorkspace({...base,catalog:[{...item,stock_reserved:2}]}))
})
