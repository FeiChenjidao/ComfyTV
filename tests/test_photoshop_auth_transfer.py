import asyncio

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from ComfyTV.photoshop import backend


async def with_client(callback):
    backend.auth_transfers.clear()
    routes = web.RouteTableDef()
    path = "/comfytv/photoshop/auth-transfer/{transfer_id}"
    routes.get(path)(backend.auth_transfer_read)
    routes.post(path)(backend.auth_transfer_write)
    routes.delete(path)(backend.auth_transfer_delete)
    app = web.Application()
    app.router.add_routes(routes)
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        await callback(client)
    finally:
        backend.auth_transfers.clear()
        await client.close()


def test_auth_transfer_round_trip_and_delete():
    async def run(client):
        transfer_id = "a" * 48
        entries = {"firebase:authUser:test:[DEFAULT]": "serialized-user"}
        envelope = {
            "version": 2,
            "localStorage": entries,
            "indexedDb": [{"key": "firebase:authUser:test:[DEFAULT]", "value": {"uid": "test"}}],
            "token": "workspace-token",
        }
        response = await client.post(
            f"/comfytv/photoshop/auth-transfer/{transfer_id}",
            json={"envelope": envelope, "ignored": "value"},
        )
        assert response.status == 200
        response = await client.get(f"/comfytv/photoshop/auth-transfer/{transfer_id}")
        assert response.status == 200
        assert await response.json() == {"ready": True, "envelope": envelope, "entries": entries}
        response = await client.delete(f"/comfytv/photoshop/auth-transfer/{transfer_id}")
        assert response.status == 200
        response = await client.get(f"/comfytv/photoshop/auth-transfer/{transfer_id}")
        assert await response.json() == {"ready": False}

    asyncio.run(with_client(run))


def test_auth_transfer_rejects_empty_payload():
    async def run(client):
        response = await client.post(
            f"/comfytv/photoshop/auth-transfer/{'b' * 48}",
            json={"entries": {"other:key": "value"}},
        )
        assert response.status == 400

    asyncio.run(with_client(run))


def test_auth_transfer_prunes_expired_payload():
    async def run(client):
        transfer_id = "c" * 48
        backend.auth_transfers[transfer_id] = {
            "envelope": {"version": 2, "localStorage": {}, "indexedDb": []},
            "expires": 0,
        }
        response = await client.get(f"/comfytv/photoshop/auth-transfer/{transfer_id}")
        assert response.status == 200
        assert await response.json() == {"ready": False}

    asyncio.run(with_client(run))
